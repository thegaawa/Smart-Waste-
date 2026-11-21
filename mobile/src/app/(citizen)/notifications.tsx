import { NotificationsList } from "@/components/NotificationsList";

export default function CitizenNotificationsScreen() {
  return <NotificationsList hrefForReport={(id) => ({ pathname: "/(citizen)/reports/[id]", params: { id } })} />;
}
