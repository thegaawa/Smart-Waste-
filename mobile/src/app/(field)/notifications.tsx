import { NotificationsList } from "@/components/NotificationsList";

export default function FieldNotificationsScreen() {
  return <NotificationsList hrefForReport={(id) => ({ pathname: "/(field)/reports/[id]", params: { id } })} />;
}
