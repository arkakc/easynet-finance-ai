import { NextRequest, NextResponse } from "next/server";
import { sessionCookie, verifySessionToken, type Permission } from "@/lib/auth";

const PUBLIC_PATHS=["/login","/api/auth/login","/api/health","/api/backend/health"];
const LEGACY_WRITE_PATHS=["/api/transactions","/api/conversions","/api/approvals","/api/assets","/api/budgets","/api/masters","/api/settings","/api/stock","/api/payment-schedules","/api/loans/actions","/api/journals/reverse","/api/setup/finance","/api/documents/extract"];
const ROUTE_PERMISSIONS:Array<[string,Permission]>=[["/conversions/sales","sales.write"],["/conversions/purchase","purchase.write"],["/users","users.manage"],["/settings","settings.manage"],["/approvals","post.approve"],["/reports","reports.read"],["/stock","stock.read"],["/assets","stock.read"],["/accounts","accounts.read"],["/journals","accounts.read"],["/loans","accounts.read"],["/statements","accounts.read"],["/budgets","accounts.read"],["/documents","accounts.read"],["/ai-finance","accounts.read"]];

function transactionRefererModule(request:NextRequest){
  const referer=request.headers.get("referer")||"";
  if(!referer)return"";
  try{
    const url=new URL(referer);
    if(url.pathname!=="/transactions")return"";
    const module=url.searchParams.get("module")||"sales";
    return module==="purchase"||module==="expense"?module:"sales";
  }catch{return"";}
}

function optimizedReadRewrite(request:NextRequest){
  if(request.method!=="GET"&&request.method!=="HEAD")return null;
  const module=transactionRefererModule(request);
  if(!module)return null;
  const pathname=request.nextUrl.pathname;

  if(pathname==="/api/erp/transactions"&&!request.nextUrl.searchParams.has("nextNumberFor")){
    const scope = module==="purchase"?"purchaseModule":module==="expense"?"expenseModule":"salesModule";
    const url = new URL(`/api/erp/transaction-list?scope=${scope}`, request.url);
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("x-erp-scope", scope);
    return NextResponse.rewrite(url, {
      request: {
        headers: requestHeaders,
      },
    });
  }

  if(pathname==="/api/masters"){
    const scope = module==="sales"?"sales":"purchase";
    const url = new URL(`/api/masters/scoped?scope=${scope}`, request.url);
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("x-erp-scope", scope);
    return NextResponse.rewrite(url, {
      request: {
        headers: requestHeaders,
      },
    });
  }

  return null;
}

export function proxy(request:NextRequest){
  const { pathname } = request.nextUrl;
  if(
    PUBLIC_PATHS.some(p=>pathname===p||pathname.startsWith(`${p}/`))||
    pathname.startsWith("/_next/")||
    pathname==="/favicon.ico"||
    /\.(png|jpg|jpeg|svg|webp|gif|ico)$/i.test(pathname)
  ) return NextResponse.next();
  const user=verifySessionToken(request.cookies.get(sessionCookie.name)?.value);
  if(!user){
    if(pathname.startsWith("/api/"))return NextResponse.json({ok:false,error:"Unauthorized"},{status:401});
    const url=request.nextUrl.clone();url.pathname="/login";url.searchParams.set("next",pathname);return NextResponse.redirect(url);
  }
  if(request.method!=="GET"&&request.method!=="HEAD"&&LEGACY_WRITE_PATHS.some(path=>pathname===path))return NextResponse.json({ok:false,error:"Direct legacy write endpoint disabled. Use user-authorized ERP action."},{status:403});
  const required=ROUTE_PERMISSIONS.find(([prefix])=>pathname===prefix||pathname.startsWith(`${prefix}/`))?.[1];
  if(required&&!user.permissions.includes(required)){
    if(pathname.startsWith("/api/"))return NextResponse.json({ok:false,error:"Forbidden"},{status:403});
    const url=request.nextUrl.clone();url.pathname="/dashboard";url.searchParams.set("denied","1");return NextResponse.redirect(url);
  }
  const optimized=optimizedReadRewrite(request);
  if(optimized)return optimized;
  return NextResponse.next();
}

export const config={matcher:["/((?!_next/static|_next/image).*)"]};
