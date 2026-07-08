import { NextResponse } from 'next/server';
import { errorEnvelope, getPortfolio, requireUser } from '@/lib/server/portfolio-service';
import type { ApiResult, PortfolioResponse } from '@/lib/contracts/api';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const data = await getPortfolio(requireUser(request));
    const result: ApiResult<PortfolioResponse> = { ok: true, data };
    return NextResponse.json(result);
  } catch (err) {
    const { status, body } = errorEnvelope(err, 500);
    return NextResponse.json(body, { status });
  }
}
