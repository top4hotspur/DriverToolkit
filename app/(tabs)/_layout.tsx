import { FontAwesome6 } from "@expo/vector-icons";
import { Tabs } from "expo-router";

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: "#1e6f50",
        tabBarInactiveTintColor: "#3f4d46",
      }}
    >
      <Tabs.Screen
        name="home"
        options={{
          title: "Home",
          tabBarIcon: ({ color, size }) => <FontAwesome6 name="house" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="diary"
        options={{
          title: "Diary",
          tabBarIcon: ({ color, size }) => <FontAwesome6 name="calendar-day" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="reports"
        options={{
          title: "Reports",
          tabBarIcon: ({ color, size }) => <FontAwesome6 name="chart-column" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="claims"
        options={{
          title: "Claims",
          tabBarIcon: ({ color, size }) => <FontAwesome6 name="sterling-sign" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: "Settings",
          tabBarIcon: ({ color, size }) => <FontAwesome6 name="sliders" color={color} size={size} />,
        }}
      />
    </Tabs>
  );
}
