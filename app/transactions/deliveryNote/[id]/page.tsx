import DeliveryNoteClient from "@/app/components/delivery-note-client";

export default async function DeliveryNotePage({params}:{params:Promise<{id:string}>}){
  const {id}=await params;
  return <DeliveryNoteClient id={id}/>;
}
