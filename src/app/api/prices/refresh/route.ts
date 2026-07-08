import { NextResponse } from 'next/server';
import { errorEnvelope, refreshPrices } from '@/lib/server/portfolio-service';
import type { ApiResult, RefreshResponse } from '@/lib/contracts/api';

export async function POST(): Promise<NextResponse> {
  try {
    const data = await refreshPrices();
    const result: ApiResult<RefreshResponse> = { ok: true, data };
    return NextResponse.json(result);
  } catch (err) {
    // Refresh hits upstream price sources — failures are 502.
    const { status, body } = errorEnvelope(err, 502);
    return NextResponse.json(body, { status });
  }
}
