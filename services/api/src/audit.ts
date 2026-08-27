import { Controller, Get, Injectable, Module, Query, UseGuards } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuthGuard, AuthModule, CurrentUser, Principal } from './auth';
import { PrismaService } from './prisma.service';

/// Append-only audit trail (MASTER SPEC 53). This service exposes no update or
/// delete method, and none exists anywhere else in the application.
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(
    tenantId: string,
    actorId: string | null,
    action: string,
    subjectType: string,
    subjectId: string,
    detail?: Prisma.InputJsonValue,
  ) {
    await this.prisma.auditEvent.create({
      data: { tenantId, actorId, action, subjectType, subjectId, detail },
    });
  }

  list(tenantId: string, take = 100) {
    return this.prisma.auditEvent.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(take, 500),
    });
  }
}

@Controller('audit')
@UseGuards(AuthGuard)
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  list(@CurrentUser() user: Principal, @Query('take') take?: string) {
    return this.audit.list(user.tenantId, take ? Number(take) : undefined);
  }
}

@Module({
  imports: [AuthModule],
  controllers: [AuditController],
  providers: [AuditService, PrismaService],
  exports: [AuditService],
})
export class AuditModule {}
