import { Text } from "react-native";
import { placeholderSettings } from "../presentation/placeholderSettings";
import { Card, KeyValueRow, ScreenShell } from "./ui";

export function SettingsScreen() {
  return (
    <ScreenShell
      title="Settings"
      subtitle="Decision-engine control panel for targets, vehicle assumptions, and start area controls."
    >
      <Card title="Targets">
        <KeyValueRow label="Target £/hour" value={`£${placeholderSettings.targetHourly.toFixed(2)}`} />
        <KeyValueRow label="Target £/mile" value={`£${placeholderSettings.targetPerMile.toFixed(2)}`} />
      </Card>

      <Card title="Vehicle Assumptions">
        <KeyValueRow label="MPG" value={`${placeholderSettings.vehicleAssumptions.mpg}`} />
        <KeyValueRow label="Fuel £/L" value={`${placeholderSettings.vehicleAssumptions.fuelPricePerLitre.toFixed(2)}`} />
        <KeyValueRow label="Maintenance £/mile" value={`${placeholderSettings.vehicleAssumptions.maintenancePerMile.toFixed(2)}`} />
      </Card>

      <Card title="Saved Start Areas + Preview Stats">
        {placeholderSettings.startAreaPreviewStats.map((area) => (
          <Text key={area.areaName}>{`${area.areaName}: £${area.trueNetPerHour.toFixed(2)}/hr, £${area.trueNetPerMile.toFixed(2)}/mile (n=${area.sampleSize})`}</Text>
        ))}
      </Card>
    </ScreenShell>
  );
}
