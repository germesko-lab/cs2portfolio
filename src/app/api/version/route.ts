import { NextResponse } from 'next/server';
import type { ApiResult } from '@/lib/contracts/api';

export const dynamic = 'force-dynamic';

export interface VersionResponse {
  /** Git commit of the running build (injected by Railway), or null. */
  commit: string | null;
  branch: string | null;
}

/** GET /api/version — which code is actually deployed. */
export function GET(): NextResponse {
  const result: ApiResult<VersionResponse> = {
    ok: true,
    data: {
      commit: process.env.RAILWAY_GIT_COMMIT_SHA ?? null,
      branch: process.env.RAILWAY_GIT_BRANCH ?? null,
    },
  };
  return NextResponse.json(result);
}
