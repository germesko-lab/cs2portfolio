import { NextResponse } from 'next/server';
import { errorEnvelope, getPortfolio } from '@/lib/server/portfolio-service';
import type { ApiResult, PortfolioResponse } from '@/lib/contracts/api';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  try {
    const data = await getPortfolio();
    const result: ApiResult<PortfolioResponse> = { ok: true, data };
    return NextResponse.json(result);
  } catch (err) {
    const { status, body } = errorEnvelope(err, 500);
    return NextResponse.json(body, { status });
  }
}
