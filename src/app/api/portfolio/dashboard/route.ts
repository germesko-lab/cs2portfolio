import { NextResponse } from 'next/server';
import { ApiError, errorEnvelope, getDashboard, requireUser } from '@/lib/server/portfolio-service';
import type { ApiResult, DashboardResponse } from '@/lib/contracts/api';

export const dynamic = 'force-dynamic';

const DEFAULT_DAYS = 30;
const MIN_DAYS = 1;
const MAX_DAYS = 365;

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const user = requireUser(request);
    const raw = new URL(request.url).searchParams.get('days');
    let days = DEFAULT_DAYS;
    if (raw !== null) {
      const parsed = Number(raw);
      if (raw.trim() === '' || !Number.isInteger(parsed)) {
        throw new ApiError(400, 'INVALID_DAYS', `"days" must be an integer, got "${raw}"`);
      }
      days = Math.min(MAX_DAYS, Math.max(MIN_DAYS, parsed));
    }
    const data = await getDashboard(user, days);
    const result: ApiResult<DashboardResponse> = { ok: true, data };
    return NextResponse.json(result);
  } catch (err) {
    const { status, body } = errorEnvelope(err, 500);
    return NextResponse.json(body, { status });
  }
}
