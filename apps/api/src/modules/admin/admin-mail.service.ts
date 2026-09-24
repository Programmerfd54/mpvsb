import { Injectable } from '@nestjs/common';
import nodemailer from 'nodemailer';

import type {
  AdminMailSettings,
  AdminMailTemplate,
  AdminMailTest,
  SaveAdminMailSettings,
  SaveAdminMailTemplate,
} from '@context/contracts';
import type { TenantTransaction } from '@context/database';

import { AuditService } from '../../platform/audit/audit.service';
import { PrismaService } from '../../platform/database/prisma.service';
import { AppError } from '../../platform/errors/app-error';
import { decryptSecret, encryptSecret } from '../../platform/security/secret-box';

@Injectable()
export class AdminMailService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async getSettings(): Promise<AdminMailSettings | null> {
    return this.prisma.platformOps(async (tx) => {
      const organizationId = await this.organizationId(tx);
      const row = await tx.workspace_mail_settings.findUnique({
        where: { organization_id: organizationId },
      });
      return row ? settingsView(row) : null;
    });
  }

  async saveSettings(
    input: SaveAdminMailSettings,
    actorUserId: string,
  ): Promise<AdminMailSettings> {
    return this.prisma.platformOps(async (tx) => {
      const organizationId = await this.organizationId(tx);
      const current = await tx.workspace_mail_settings.findUnique({
        where: { organization_id: organizationId },
      });
      if (current && input.expectedRevision !== current.revision) throw AppError.revisionConflict();
      if (!current && input.expectedRevision !== null) throw AppError.revisionConflict();
      if (!current && !input.password)
        throw AppError.validation([{ field: 'password', message: 'Укажите пароль SMTP' }]);
      const password = input.password
        ? encryptSecret(input.password)
        : (current?.password_encrypted ?? null);
      const row = await tx.workspace_mail_settings.upsert({
        where: { organization_id: organizationId },
        create: {
          organization_id: organizationId,
          host: input.host,
          port: input.port,
          secure: input.secure,
          username: input.username,
          password_encrypted: password,
          from_email: input.fromEmail,
          from_name: input.fromName,
        },
        update: {
          host: input.host,
          port: input.port,
          secure: input.secure,
          username: input.username,
          password_encrypted: password,
          from_email: input.fromEmail,
          from_name: input.fromName,
          verified_at: null,
          last_test_error_code: null,
          revision: { increment: 1 },
        },
      });
      await this.audit.recordIn(tx, {
        action: 'workspace.mail_settings_updated',
        outcome: 'success',
        organizationId,
        resourceType: 'organization',
        resourceId: organizationId,
        metadata: { passwordReplaced: Boolean(input.password), actorUserId },
      });
      return settingsView(row);
    });
  }

  async test(actorUserId: string): Promise<AdminMailTest> {
    const config = await this.prisma.platformOps(async (tx) => {
      const organizationId = await this.organizationId(tx);
      const row = await tx.workspace_mail_settings.findUnique({
        where: { organization_id: organizationId },
      });
      if (!row) throw AppError.conflict('Сначала сохраните настройки SMTP');
      return { organizationId, row };
    });
    const testedAt = new Date();
    try {
      const transport = nodemailer.createTransport({
        host: config.row.host,
        port: config.row.port,
        secure: config.row.secure,
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        auth: config.row.username
          ? {
              user: config.row.username,
              pass: config.row.password_encrypted
                ? decryptSecret(config.row.password_encrypted)
                : '',
            }
          : undefined,
      });
      await transport.verify();
      await this.markTest(config.organizationId, testedAt, null, actorUserId);
      return {
        connected: true,
        testedAt: testedAt.toISOString(),
        message: 'Соединение и авторизация SMTP подтверждены. Тестовое письмо не отправлялось.',
      };
    } catch (error) {
      const code = safeMailErrorCode(error);
      await this.markTest(config.organizationId, testedAt, code, actorUserId);
      throw new AppError('DEPENDENCY_UNAVAILABLE', {
        title: 'Не удалось подключиться к SMTP',
        internalDetail: code,
      });
    }
  }

  async getTemplate(): Promise<AdminMailTemplate> {
    return this.prisma.platformOps(async (tx) => {
      const organizationId = await this.organizationId(tx);
      const row = await tx.workspace_mail_templates.findUnique({
        where: { organization_id: organizationId },
      });
      return templateView(
        row ?? {
          subject: 'Доступ к платформе «Контекст»',
          greeting: 'Здравствуйте, {{name}}!',
          body: 'Для вас создан доступ к рабочему пространству. Установите пароль по кнопке ниже.',
          button_label: 'Войти и задать пароль',
          signature: 'Команда {{organization}}',
          support_contact: null,
          status: 'draft',
          revision: 1,
          published_at: null,
        },
      );
    });
  }

  async saveTemplate(
    input: SaveAdminMailTemplate,
    actorUserId: string,
  ): Promise<AdminMailTemplate> {
    return this.prisma.platformOps(async (tx) => {
      const organizationId = await this.organizationId(tx);
      const current = await tx.workspace_mail_templates.findUnique({
        where: { organization_id: organizationId },
      });
      if (current && input.expectedRevision !== current.revision) throw AppError.revisionConflict();
      if (!current && input.expectedRevision !== null) throw AppError.revisionConflict();
      const now = new Date();
      const row = await tx.workspace_mail_templates.upsert({
        where: { organization_id: organizationId },
        create: {
          organization_id: organizationId,
          subject: input.subject,
          greeting: input.greeting,
          body: input.body,
          button_label: input.buttonLabel,
          signature: input.signature,
          support_contact: input.supportContact,
          status: input.publish ? 'published' : 'draft',
          published_at: input.publish ? now : null,
        },
        update: {
          subject: input.subject,
          greeting: input.greeting,
          body: input.body,
          button_label: input.buttonLabel,
          signature: input.signature,
          support_contact: input.supportContact,
          status: input.publish ? 'published' : 'draft',
          published_at: input.publish ? now : current?.published_at,
          revision: { increment: 1 },
        },
      });
      await this.audit.recordIn(tx, {
        action: input.publish
          ? 'workspace.mail_template_published'
          : 'workspace.mail_template_saved',
        outcome: 'success',
        organizationId,
        resourceType: 'organization',
        resourceId: organizationId,
        metadata: { actorUserId },
      });
      return templateView(row);
    });
  }

  private async markTest(
    organizationId: string,
    testedAt: Date,
    errorCode: string | null,
    actorUserId: string,
  ): Promise<void> {
    await this.prisma.platformOps(async (tx) => {
      await tx.workspace_mail_settings.update({
        where: { organization_id: organizationId },
        data: { verified_at: errorCode ? null : testedAt, last_test_error_code: errorCode },
      });
      await this.audit.recordIn(tx, {
        action: 'workspace.mail_connection_tested',
        outcome: errorCode ? 'failed' : 'success',
        organizationId,
        resourceType: 'organization',
        resourceId: organizationId,
        metadata: { errorCode, actorUserId },
      });
    });
  }

  private async organizationId(tx: TenantTransaction): Promise<string> {
    const state = await tx.workspace_state.findUnique({
      where: { singleton: true },
      select: { organization_id: true },
    });
    if (!state) throw AppError.notFound('Основное пространство не создано');
    return state.organization_id;
  }
}

function settingsView(row: {
  host: string;
  port: number;
  secure: boolean;
  username: string | null;
  password_encrypted: string | null;
  from_email: string;
  from_name: string;
  revision: number;
  verified_at: Date | null;
  last_test_error_code: string | null;
}): AdminMailSettings {
  return {
    host: row.host,
    port: row.port,
    secure: row.secure,
    username: row.username,
    passwordConfigured: Boolean(row.password_encrypted),
    fromEmail: row.from_email,
    fromName: row.from_name,
    revision: row.revision,
    verifiedAt: row.verified_at?.toISOString() ?? null,
    lastTestErrorCode: row.last_test_error_code,
  };
}
function templateView(row: {
  subject: string;
  greeting: string;
  body: string;
  button_label: string;
  signature: string;
  support_contact: string | null;
  status: string;
  revision: number;
  published_at: Date | null;
}): AdminMailTemplate {
  return {
    subject: row.subject,
    greeting: row.greeting,
    body: row.body,
    buttonLabel: row.button_label,
    signature: row.signature,
    supportContact: row.support_contact,
    status: row.status as 'draft' | 'published',
    revision: row.revision,
    publishedAt: row.published_at?.toISOString() ?? null,
  };
}
function safeMailErrorCode(error: unknown): string {
  if (typeof error === 'object' && error && 'code' in error && typeof error.code === 'string')
    return error.code.slice(0, 100);
  return 'smtp_connection_failed';
}
