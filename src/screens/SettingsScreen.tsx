import { useEffect, useState } from "react";
import { Text } from "react-native";
import { placeholderSettings } from "../presentation/placeholderSettings";
import { getAppSettings } from "../state/settingsState";
import { AppSettingsModel } from "../state/settingsTypes";
import { daysUntil, shouldShowDueWarning } from "../utils/dueDates";
import { formatGBP } from "../utils/format";
import { Card, KeyValueRow, ScreenShell } from "./ui";

export function SettingsScreen() {
  const [settings, setSettings] = useState<AppSettingsModel | null>(null);

  useEffect(() => {
    getAppSettings()
      .then((next) => setSettings(next))
      .catch(() => setSettings(null));
  }, []);

  const effective = settings ?? {
    taxSavingsAmount: placeholderSettings.taxSavingsAmount,
    estimatedTaxLiability: placeholderSettings.estimatedTaxLiability,
    psvDueDate: placeholderSettings.psvDueDate,
    insuranceDueDate: placeholderSettings.insuranceDueDate,
    maxStartShiftTravelRadiusMiles: placeholderSettings.maxStartShiftTravelRadiusMiles,
  };

  return (
    <ScreenShell
      title="Settings"
      subtitle="Decision-engine control panel for targets, costs, obligations, and start-shift controls."
    >
      <Card title="Targets">
        <KeyValueRow label="Target £/hour" value={formatGBP(placeholderSettings.targetHourly)} />
        <KeyValueRow label="Target £/mile" value={formatGBP(placeholderSettings.targetPerMile)} />
      </Card>

      <Card title="Vehicle Assumptions">
        <KeyValueRow label="MPG" value={`${placeholderSettings.vehicleAssumptions.mpg}`} />
        <KeyValueRow label="Fuel £/L" value={formatGBP(placeholderSettings.vehicleAssumptions.fuelPricePerLitre)} />
        <KeyValueRow label="Maintenance £/mile" value={formatGBP(placeholderSettings.vehicleAssumptions.maintenancePerMile)} />
      </Card>

      <Card title="Tax + Compliance Controls">
        <KeyValueRow label="Tax savings amount" value={formatGBP(effective.taxSavingsAmount)} />
        <KeyValueRow label="Estimated tax liability" value={formatGBP(effective.estimatedTaxLiability)} />
        <KeyValueRow label="PSV due date" value={effective.psvDueDate ?? "Not set"} />
        <KeyValueRow label="Insurance due date" value={effective.insuranceDueDate ?? "Not set"} />
        <KeyValueRow
          label="Max start-shift travel radius"
          value={`${effective.maxStartShiftTravelRadiusMiles.toFixed(1)} miles`}
        />
        <Text>
          How far are you prepared to travel to start your shift? Used when checking whether a nearby area would be a
          better place to begin working.
        </Text>
      </Card>

      <Card title="Upcoming Warnings">
        {effective.psvDueDate && shouldShowDueWarning(effective.psvDueDate, 42) ? (
          <Text>{`PSV due in ${daysUntil(effective.psvDueDate)} days`}</Text>
        ) : (
          <Text>PSV is not due within 6 weeks.</Text>
        )}
        {effective.insuranceDueDate && shouldShowDueWarning(effective.insuranceDueDate, 42) ? (
          <Text>{`Insurance renewal due in ${daysUntil(effective.insuranceDueDate)} days`}</Text>
        ) : (
          <Text>Insurance renewal is not due within 6 weeks.</Text>
        )}
      </Card>

      <Card title="Saved Start Areas + Preview Stats">
        {placeholderSettings.startAreaPreviewStats.map((area) => (
          <Text key={area.areaName}>{`${area.areaName}: ${formatGBP(area.trueNetPerHour)}/hr, ${formatGBP(area.trueNetPerMile)}/mile (n=${area.sampleSize})`}</Text>
        ))}
      </Card>
    </ScreenShell>
  );
}

