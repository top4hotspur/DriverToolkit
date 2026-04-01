import { useEffect, useState } from "react";
import { Text, TextInput, View } from "react-native";
import { placeholderSettings } from "../presentation/placeholderSettings";
import { getAppSettings } from "../state/settingsState";
import { AppSettingsModel } from "../state/settingsTypes";
import { getTargetSettings, saveTargetSettings } from "../state/targetsState";
import { addStartPoint, listStartPoints, removeStartPoint, updateStartPoint } from "../state/startPoints";
import { StartPoint } from "../state/startPointTypes";
import { daysUntil, shouldShowDueWarning } from "../utils/dueDates";
import { formatGBP } from "../utils/format";
import { Card, KeyValueRow, PrimaryButton, ScreenShell } from "./ui";

export function SettingsScreen() {
  const [settings, setSettings] = useState<AppSettingsModel | null>(null);
  const [targetHourlyInput, setTargetHourlyInput] = useState(`${placeholderSettings.targetHourly}`);
  const [targetMileInput, setTargetMileInput] = useState(`${placeholderSettings.targetPerMile}`);
  const [startPoints, setStartPoints] = useState<StartPoint[]>([]);
  const [newPostcode, setNewPostcode] = useState("");
  const [newLabel, setNewLabel] = useState("");

  useEffect(() => {
    Promise.all([getAppSettings(), listStartPoints(), getTargetSettings()])
      .then(([nextSettings, points, targets]) => {
        setSettings(nextSettings);
        setStartPoints(points);
        setTargetHourlyInput(`${targets.targetHourly}`);
        setTargetMileInput(`${targets.targetPerMile}`);
      })
      .catch(() => {
        setSettings(null);
        setStartPoints([]);
      });
  }, []);

  const effective = settings ?? {
    taxSavingsAmount: placeholderSettings.taxSavingsAmount,
    estimatedTaxLiability: placeholderSettings.estimatedTaxLiability,
    psvDueDate: placeholderSettings.psvDueDate,
    insuranceDueDate: placeholderSettings.insuranceDueDate,
    operatorLicenceDueDate: placeholderSettings.operatorLicenceDueDate,
    trainingHoursCompleted: placeholderSettings.trainingHoursCompleted,
    taxCorrectToDate: placeholderSettings.taxCorrectToDate,
    maxStartShiftTravelRadiusMiles: placeholderSettings.maxStartShiftTravelRadiusMiles,
  };

  const addPoint = async () => {
    if (!newPostcode.trim()) {
      return;
    }

    await addStartPoint({ postcode: newPostcode, label: newLabel || newPostcode });
    setStartPoints(await listStartPoints());
    setNewPostcode("");
    setNewLabel("");
  };

  const removePoint = async (id: string) => {
    await removeStartPoint(id);
    setStartPoints(await listStartPoints());
  };

  const renamePoint = async (point: StartPoint) => {
    await updateStartPoint(point.id, {
      postcode: point.postcode,
      label: `${point.label} (Updated)`,
    });
    setStartPoints(await listStartPoints());
  };

  const saveTargets = async () => {
    const parsedHourly = Number(targetHourlyInput);
    const parsedMile = Number(targetMileInput);
    if (!Number.isFinite(parsedHourly) || !Number.isFinite(parsedMile)) {
      return;
    }

    await saveTargetSettings({
      targetHourly: parsedHourly,
      targetPerMile: parsedMile,
    });
  };

  return (
    <ScreenShell
      title="Settings"
      subtitle="Decision controls, compliance dates, and preferred postcode starting points."
    >
      <Card title="Targets (Editable)">
        <Text>Target £/hour</Text>
        <TextInput value={targetHourlyInput} onChangeText={setTargetHourlyInput} style={styles.input} keyboardType="decimal-pad" />
        <Text>Target £/mile</Text>
        <TextInput value={targetMileInput} onChangeText={setTargetMileInput} style={styles.input} keyboardType="decimal-pad" />
        <PrimaryButton label="Save targets" onPress={saveTargets} />
      </Card>

      <Card title="Vehicle Assumptions">
        <KeyValueRow label="MPG" value={`${placeholderSettings.vehicleAssumptions.mpg}`} />
        <KeyValueRow label="Fuel £/L" value={formatGBP(placeholderSettings.vehicleAssumptions.fuelPricePerLitre)} />
        <KeyValueRow label="Maintenance £/mile" value={formatGBP(placeholderSettings.vehicleAssumptions.maintenancePerMile)} />
      </Card>

      <Card title="Tax + Compliance Controls">
        <KeyValueRow label="Tax savings amount" value={formatGBP(effective.taxSavingsAmount)} />
        <KeyValueRow label="Estimated tax liability" value={formatGBP(effective.estimatedTaxLiability)} />
        <KeyValueRow label="Tax correct to" value={effective.taxCorrectToDate ?? "Not set"} />
        <KeyValueRow label="PSV due date" value={effective.psvDueDate ?? "Not set"} />
        <KeyValueRow label="Insurance due date" value={effective.insuranceDueDate ?? "Not set"} />
        <KeyValueRow label="Operator licence expiry" value={effective.operatorLicenceDueDate ?? "Not set"} />
        <KeyValueRow label="Training hours completed" value={effective.trainingHoursCompleted.toFixed(2)} />
        <KeyValueRow
          label="Max start-shift travel radius"
          value={`${effective.maxStartShiftTravelRadiusMiles.toFixed(1)} miles`}
        />
        <Text>
          How far are you prepared to travel to start your shift? Used when checking whether a nearby area would be a
          better place to begin working.
        </Text>
      </Card>

      <Card title="Upcoming Warnings Preview">
        {effective.psvDueDate && shouldShowDueWarning(effective.psvDueDate, 42) ? (
          <Text>{`PSV due in ${daysUntil(effective.psvDueDate)} days`}</Text>
        ) : (
          <Text>PSV warning not active.</Text>
        )}
        {effective.insuranceDueDate && shouldShowDueWarning(effective.insuranceDueDate, 42) ? (
          <Text>{`Insurance renewal due in ${daysUntil(effective.insuranceDueDate)} days`}</Text>
        ) : (
          <Text>Insurance warning not active.</Text>
        )}
      </Card>

      <Card title="Preferred Starting Points (Postcode)">
        <Text>Set the postcodes you are prepared to start from. These power start recommendations.</Text>
        <TextInput
          value={newPostcode}
          onChangeText={setNewPostcode}
          style={styles.input}
          placeholder="Postcode (e.g. BT7)"
        />
        <TextInput
          value={newLabel}
          onChangeText={setNewLabel}
          style={styles.input}
          placeholder="Optional label"
        />
        <PrimaryButton label="Add start point" onPress={addPoint} />

        {startPoints.length === 0 ? (
          <Text>Don't forget to set your preferred starting points - you can always change these later.</Text>
        ) : (
          startPoints.map((point) => (
            <View key={point.id} style={styles.pointRow}>
              <Text>{`${point.postcode} - ${point.label}`}</Text>
              <View style={styles.rowButtons}>
                <PrimaryButton label="Edit label" onPress={() => renamePoint(point)} />
                <PrimaryButton label="Remove" onPress={() => removePoint(point.id)} />
              </View>
            </View>
          ))
        )}
      </Card>
    </ScreenShell>
  );
}

const styles = {
  input: {
    borderWidth: 1,
    borderColor: "#c5cbc3",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 8,
  },
  pointRow: {
    marginTop: 10,
    gap: 6,
  },
  rowButtons: {
    flexDirection: "row" as const,
    gap: 8,
    flexWrap: "wrap" as const,
  },
};

