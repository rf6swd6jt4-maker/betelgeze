import { NextRequest, NextResponse } from "next/server"
import { createSupabaseRouteClient } from "@/lib/supabase/route"
export async function GET(request: NextRequest) { const response = NextResponse.redirect(new URL("/", request.url)); await createSupabaseRouteClient(request, response).auth.signOut(); return response }
