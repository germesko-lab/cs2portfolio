import { NextResponse } from 'next/server';
import {
  ApiError,
  errorEnvelope,
  requireUser,
  resetCostBasis,
  setManualCostBasis,
} from '@/lib/server/portfolio-service';
import type { ApiResult, CostBasisResponse } from '@/lib/contracts/api';

type RouteContext = { params: Promise<{ assetId: string }> };

export async function PATCH(request: Request, { params }: RouteContext): Promise<NextResponse> {
  try {
    const user = requireUser(request);
    const { assetId } = await params;

    let amountCents: unknown;
    try {
      const body: unknown = await request.json();
      if (typeof body === 'object' && body !== null && 'amountCents' in body) {
        amountCents = (body as { amountCents: unknown }).amountCents;
      }
    } catch {
      throw new ApiError(400, 'INVALID_BODY', 'Request body must be JSON: { amountCents }');
    }
    if (typeof amountCents !== 'number') {
      throw new ApiError(400, 'INVALID_AMOUNT', 'amountCents must be a number of cents');
    }

    const position = await setManualCostBasis(user, assetId, amountCents);
    const result: ApiResult<CostBasisResponse> = { ok: true, data: { position } };
    return NextResponse.json(result);
  } catch (err) {
    const { status, body } = errorEnvelope(err, 500);
    return NextResponse.json(body, { status });
  }
}

export async function DELETE(_request: Request, { params }: RouteContext): Promise<NextResponse> {
  try {
    const user = requireUser(_request);
    const { assetId } = await params;
    const position = await resetCostBasis(user, assetId);
    const result: ApiResult<CostBasisResponse> = { ok: true, data: { position } };
    return NextResponse.json(result);
  } catch (err) {
    const { status, body } = errorEnvelope(err, 500);
    return NextResponse.json(body, { status });
  }
}
