import { NextResponse } from "next/server";
import { getValidatedCompanyAccess } from "@/lib/workflow/erp-server-authorization";
import { effectiveCompanyRoles, canAccessCompanyResource } from "@/lib/workflow/erp-company-access";
import { DOCUMENT_KINDS } from "@/lib/workflow/erp-approval-policy";
import { ACCOUNTING_FUNCTIONS, PRIVILEGE_ACTIONS } from "@/lib/workflow/erp-role-privileges";

/** Authenticated read-only capability snapshot. No user or role is accepted from JSON.
 * The company selector is verified against assignments in the database.
 */
export async function GET(request: Request) {
  try {
    const companyId=new URL(request.url).searchParams.get("companyId")?.trim() || "";
    const ctx=await getValidatedCompanyAccess(request,companyId);
    const roles=effectiveCompanyRoles(ctx.assignments,ctx.user.userId!,companyId);
    const actions=(resource: {kind:"DOCTYPE";name:typeof DOCUMENT_KINDS[number]}|{kind:"ACCOUNTING";name:typeof ACCOUNTING_FUNCTIONS[number]})=>
      PRIVILEGE_ACTIONS.filter(action=>canAccessCompanyResource(ctx.assignments,ctx.overrides,
      {userId:ctx.user.userId!,companyId},resource,action));
    return NextResponse.json({ok:true,companyId,roles,
      documentTypes:DOCUMENT_KINDS.map(name=>({name,actions:actions({kind:"DOCTYPE",name})})).filter(r=>r.actions.length),
      accountingFunctions:ACCOUNTING_FUNCTIONS.map(name=>({name,actions:actions({kind:"ACCOUNTING",name})})).filter(r=>r.actions.length),
    },{headers:{"Cache-Control":"no-store"}});
  } catch(e) {
    const message=e instanceof Error?e.message:"Failed";
    return NextResponse.json({ok:false,error:message},{status:message==="Unauthorized"?401:message==="Forbidden"?403:400,
      headers:{"Cache-Control":"no-store"}});
  }
}
