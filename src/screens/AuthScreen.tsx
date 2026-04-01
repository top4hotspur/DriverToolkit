import { Text } from "react-native";
import { Card, ScreenShell } from "./ui";

export function AuthScreen() {
  return (
    <ScreenShell title="Auth" subtitle="Authentication lives outside the main app shell.">
      <Card title="Auth Shell">
        <Text>Sign-in and subscription entitlement screens land here in later phases.</Text>
      </Card>
    </ScreenShell>
  );
}
