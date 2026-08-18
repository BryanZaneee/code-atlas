export async function GET(request: Request, { params }: { params: { id: string } }) {
  return new Response("ok");
}

export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  return new Response("ok");
}
