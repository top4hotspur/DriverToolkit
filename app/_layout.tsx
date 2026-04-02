import { Stack } from "expo-router";

export default function RootLayout() {
  return (
    <Stack>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="upload" options={{ title: "Upload" }} />
      <Stack.Screen name="expenses/upload" options={{ title: "Upload Expense" }} />
      <Stack.Screen name="expenses/cash" options={{ title: "Add Cash Expense" }} />
      <Stack.Screen name="expenses/history" options={{ title: "Expenses" }} />
      <Stack.Screen name="expenses/[expenseId]" options={{ title: "Expense Detail" }} />
      <Stack.Screen name="reports/achievements" options={{ title: "Achievements" }} />
      <Stack.Screen name="reports/detail/[reportId]" options={{ title: "Detailed Analysis" }} />
      <Stack.Screen name="auth" options={{ title: "Auth" }} />
    </Stack>
  );
}
