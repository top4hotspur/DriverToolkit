import { Text } from "react-native";
import { placeholderUploadStatusPanel } from "../presentation/placeholderUpload";
import { Card, ScreenShell } from "./ui";

export function UploadScreen() {
  return (
    <ScreenShell
      title="Upload"
      subtitle="Your privacy export powers recommendations, reports, and achievements."
    >
      <Card title="Why Upload Matters">
        <Text>Driver Toolkit uses imported historical trips, your local costs, and diary context.</Text>
        <Text>No fake live tracking, and no cloud dependency for personal history.</Text>
      </Card>

      <Card title="How To Get Your File">
        <Text>1. Request privacy export from your provider portal.</Text>
        <Text>2. Download ZIP/CSV when ready.</Text>
        <Text>3. Import file locally into Driver Toolkit.</Text>
      </Card>

      <Card title={placeholderUploadStatusPanel.title}>
        <Text>{placeholderUploadStatusPanel.description}</Text>
        <Text>{`Accepted: ${placeholderUploadStatusPanel.acceptedFileTypes.join(", ")}`}</Text>
        {placeholderUploadStatusPanel.latestImportSummary ? <Text>{placeholderUploadStatusPanel.latestImportSummary}</Text> : null}
      </Card>
    </ScreenShell>
  );
}
