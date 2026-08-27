import {
  Body,
  CanActivate,
  Controller,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Module,
  Post,
  SetMetadata,
  UnauthorizedException,
  createParamDecorator,
} from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { IsEmail, IsString, MinLength } from 'class-validator';
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { PrismaService } from './prisma.service';

const scryptAsync = promisify(scrypt) as (
  pw: string,
  salt: Buffer,
  len: number,
) => Promise<Buffer>;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, 64);
  return `scrypt:${salt.toString('hex')}:${key.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltHex, keyHex] = stored.split(':');
  if (scheme !== 'scrypt' || !saltHex || !keyHex) return false;
  const key = await scryptAsync(password, Buffer.from(saltHex, 'hex'), 64);
  const expected = Buffer.from(keyHex, 'hex');
  return key.length === expected.length && timingSafeEqual(key, expected);
}

export interface Principal {
  userId: string;
  tenantId: string;
  role: Role;
  email: string;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): Principal => ctx.switchToHttp().getRequest().user,
);

export const Roles = (...roles: Role[]) => SetMetadata('roles', roles);

/// Authentication + tenancy + RBAC (MASTER SPEC 51/52). Every request carries a
/// tenant; services filter by it. There is no cross-tenant read path.
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const header: string | undefined = req.headers?.authorization;
    if (!header?.startsWith('Bearer ')) throw new UnauthorizedException('missing bearer token');
    let principal: Principal;
    try {
      principal = await this.jwt.verifyAsync<Principal>(header.slice(7));
    } catch {
      throw new UnauthorizedException('invalid token');
    }
    req.user = principal;

    const required = this.reflector.getAllAndOverride<Role[] | undefined>('roles', [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (required?.length && !required.includes(principal.role)) {
      throw new ForbiddenException(`role ${principal.role} may not perform this action`);
    }
    return true;
  }
}

class LoginDto {
  @IsEmail() email: string;
  @IsString() @MinLength(8) password: string;
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  @Post('login')
  async login(@Body() dto: LoginDto) {
    const user = await this.prisma.user.findFirst({ where: { email: dto.email } });
    // Same error either way: never disclose whether the address exists.
    const ok = user ? await verifyPassword(dto.password, user.passwordHash) : false;
    if (!user || !ok) throw new UnauthorizedException('invalid credentials');

    const principal: Principal = {
      userId: user.id,
      tenantId: user.tenantId,
      role: user.role,
      email: user.email,
    };
    return {
      accessToken: await this.jwt.signAsync(principal),
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
    };
  }
}

@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET ?? 'controlshift-dev-secret-change-me',
      signOptions: { expiresIn: '12h' },
    }),
  ],
  controllers: [AuthController],
  providers: [PrismaService, AuthGuard],
  exports: [JwtModule, AuthGuard],
})
export class AuthModule {}
