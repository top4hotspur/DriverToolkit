import { ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

export function ScreenShell(props: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footerCta?: ReactNode;
}) {
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>{props.title}</Text>
      {props.subtitle ? <Text style={styles.subtitle}>{props.subtitle}</Text> : null}
      {props.children}
      {props.footerCta ? <View style={styles.footer}>{props.footerCta}</View> : null}
    </ScrollView>
  );
}

export function Card(props: { title: string; children: ReactNode; compact?: boolean }) {
  return (
    <View style={[styles.card, props.compact ? styles.compactCard : null]}>
      <Text style={styles.cardTitle}>{props.title}</Text>
      <View>{props.children}</View>
    </View>
  );
}

export function KeyValueRow(props: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{props.label}</Text>
      <Text style={styles.value}>{props.value}</Text>
    </View>
  );
}

export function ConfidenceBadge(props: { level: string; sampleSize: number }) {
  return (
    <View style={styles.badge}>
      <Text style={styles.badgeText}>{`Confidence ${props.level} · n=${props.sampleSize}`}</Text>
    </View>
  );
}

export function PrimaryButton(props: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={props.onPress} style={styles.button}>
      <Text style={styles.buttonText}>{props.label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f7f5f0",
  },
  content: {
    padding: 16,
    paddingTop: 24,
    gap: 12,
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
    color: "#102820",
  },
  subtitle: {
    fontSize: 14,
    color: "#3f4d46",
    marginBottom: 8,
  },
  card: {
    backgroundColor: "#ffffff",
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: "#d9ddd4",
    gap: 8,
  },
  compactCard: {
    paddingVertical: 10,
  },
  cardTitle: {
    fontSize: 17,
    fontWeight: "600",
    color: "#1f302b",
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 8,
  },
  label: {
    color: "#3f4d46",
    flex: 1,
  },
  value: {
    color: "#102820",
    fontWeight: "600",
  },
  badge: {
    alignSelf: "flex-start",
    borderRadius: 999,
    backgroundColor: "#d8ede1",
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  badgeText: {
    color: "#21553f",
    fontSize: 12,
    fontWeight: "600",
  },
  button: {
    backgroundColor: "#1e6f50",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    alignSelf: "flex-start",
  },
  buttonText: {
    color: "#f7f5f0",
    fontWeight: "700",
  },
  footer: {
    paddingTop: 4,
    paddingBottom: 24,
  },
});
