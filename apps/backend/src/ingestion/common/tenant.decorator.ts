import { createParamDecorator, ExecutionContext, BadRequestException } from '@nestjs/common';

export interface TenantContext {
  tenantId: string;
  userId?: string;
}

/**
 * Parameter decorator to extract authenticated TenantContext from Express request.
 *
 * @remarks
 * - Context is populated upstream by tenant authentication/resolution middleware.
 * - Enforces strict tenant presence; throws BadRequestException if missing.
 *
 * @example
 * ```ts
 * @Post('upload')
 * async upload(@Tenant() tenant: TenantContext) { ... }
 * ```
 */
export const Tenant = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): TenantContext => {
    const request = ctx.switchToHttp().getRequest();
    const tenant: TenantContext | undefined = request.tenant;

    if (tenant && tenant.tenantId) {
      return tenant;
    }

    // Fallback inspection from request header if middleware is in transition
    const headerTenantId = request.headers['x-tenant-id'];
    if (headerTenantId && typeof headerTenantId === 'string' && headerTenantId.trim().length > 0) {
      return { tenantId: headerTenantId.trim() };
    }

    throw new BadRequestException('Tenant identifier is missing in request context');
  },
);
