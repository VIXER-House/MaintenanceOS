import { requirePageUser, MANAGERS } from "@/lib/auth";
import { DemoRunner } from "@/features/demo/demo-runner";

export default async function DemoPage() {
  await requirePageUser(MANAGERS);
  return <DemoRunner />;
}
