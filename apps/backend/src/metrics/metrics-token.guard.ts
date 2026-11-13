import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';
import type { Request } from 'express';

/**
 * Protects /metrics with `Authorization: Bearer <METRICS_TOKEN>` when METRICS_TOKEN is set.
 *
 * @remarks
 * Without METRICS_TOKEN the endpoint stays open (local scraping); production logs a warning at
 * startup (see env.validation.ts). Point the scraper's bearer token at the same value.
 */
@Injectable()
export class MetricsTokenGuard implements CanActivate {
  constructor(@Optional() private readonly configService?: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.configService?.get<string>('METRICS_TOKEN');
    if (!expected) return true;

    const header = context.switchToHttp().getRequest<Request>().headers.authorization ?? '';
    const provided = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';

    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException();
    }
    return true;
  }
}
