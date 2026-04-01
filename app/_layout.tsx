import { Stack } from "expo-router";

export default function RootLayout() {
  return (
    <Stack>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="upload" options={{ title: "Upload" }} />
      <Stack.Screen name="reports/achievements" options={{ title: "Achievements" }} />
      <Stack.Screen name="reports/detail/[reportId]" options={{ title: "Detailed Analysis" }} />
      <Stack.Screen name="auth" options={{ title: "Auth" }} />
    </Stack>
  );
}
