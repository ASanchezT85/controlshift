import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { AuditModule, AuditService } from './audit';
import { AuthGuard, AuthModule, CurrentUser, Principal, Roles } from './auth';
import { PrismaService } from './prisma.service';

/**
 * Report branding (MASTER SPEC 39). Reports are delivered B2B2B: the
 * integrator's identity on the cover, the end customer's name from the
 * opportunity, and optionally the customer's own logo.
 */

/// A logo is injected into an `<img src>` in a generated HTML document, so the
/// scheme is validated rather than trusted.
export const MAX_LOGO_BYTES = 256 * 1024;

// SVG is refused deliberately: it is a document format that can carry script,
// and these logos are rendered inside a report someone forwards by email.
const RASTER = /^data:image\/(png|jpeg|jpg|gif|webp);base64,([A-Za-z0-9+/]+={0,2})$/;

export function validateLogo(value: string): string {
  const compact = value.trim();
  const match = RASTER.exec(compact);
  if (!match) {
    throw new BadRequestException(
      'logo must be a base64 data URI of a PNG, JPEG, GIF or WEBP image. ' +
        'SVG is not accepted: it can carry script into a document that gets forwarded',
    );
  }
  const bytes = Math.floor((match[2].length * 3) / 4);
  if (bytes > MAX_LOGO_BYTES) {
    throw new BadRequestException(`logo exceeds ${MAX_LOGO_BYTES} bytes (${bytes} decoded)`);
  }
  return compact;
}

class BrandingDto {
  @IsOptional() @IsString() @MaxLength(120) brandName?: string;
  @IsOptional() @IsString() @MaxLength(200) reportFooter?: string;
  @IsOptional() @IsString() @MaxLength(120) preparedByLine?: string;
  /// Empty string clears the logo; a data URI replaces it.
  @IsOptional() @IsString() @MaxLength(400_000) brandLogo?: string;
}

class CustomerLogoDto {
  @IsString() @MaxLength(400_000) customerLogo: string;
}

@Injectable()
export class BrandingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  get(tenantId: string) {
    return this.prisma.tenant.findFirstOrThrow({
      where: { id: tenantId },
      select: {
        name: true,
        brandName: true,
        brandLogo: true,
        reportFooter: true,
        preparedByLine: true,
        uncertaintyAllowancePercent: true,
      },
    });
  }

  async update(user: Principal, dto: BrandingDto) {
    const data: Record<string, string | null> = {};
    for (const key of ['brandName', 'reportFooter', 'preparedByLine'] as const) {
      if (dto[key] !== undefined) data[key] = dto[key]!.trim() || null;
    }
    if (dto.brandLogo !== undefined) {
      data.brandLogo = dto.brandLogo.trim() ? validateLogo(dto.brandLogo) : null;
    }
    await this.prisma.tenant.update({ where: { id: user.tenantId }, data });
    await this.audit.record(user.tenantId, user.userId, 'branding.updated', 'Tenant', user.tenantId, {
      fields: Object.keys(data),
    });
    return this.get(user.tenantId);
  }

  async setCustomerLogo(user: Principal, opportunityId: string, value: string) {
    const opportunity = await this.prisma.opportunity.findFirst({
      where: { id: opportunityId, tenantId: user.tenantId },
    });
    if (!opportunity) throw new NotFoundException('opportunity not found');

    const customerLogo = value.trim() ? validateLogo(value) : null;
    await this.prisma.opportunity.update({ where: { id: opportunityId }, data: { customerLogo } });
    await this.audit.record(
      user.tenantId,
      user.userId,
      customerLogo ? 'branding.customer_logo_set' : 'branding.customer_logo_cleared',
      'Opportunity',
      opportunityId,
    );
    return { customerLogo };
  }
}

@Controller()
@UseGuards(AuthGuard)
export class BrandingController {
  constructor(private readonly svc: BrandingService) {}

  @Get('organization/branding')
  get(@CurrentUser() user: Principal) {
    return this.svc.get(user.tenantId);
  }

  /// The organization's identity on every document it sends out: admin only.
  @Patch('organization/branding')
  @Roles(Role.ORG_ADMIN)
  update(@CurrentUser() user: Principal, @Body() dto: BrandingDto) {
    return this.svc.update(user, dto);
  }

  @Patch('opportunities/:id/customer-logo')
  @Roles(Role.ORG_ADMIN, Role.ESTIMATOR, Role.PROJECT_MANAGER)
  setCustomerLogo(
    @CurrentUser() user: Principal,
    @Param('id') id: string,
    @Body() dto: CustomerLogoDto,
  ) {
    return this.svc.setCustomerLogo(user, id, dto.customerLogo);
  }
}

@Module({
  imports: [AuthModule, AuditModule],
  controllers: [BrandingController],
  providers: [BrandingService, PrismaService],
  exports: [BrandingService],
})
export class BrandingModule {}
