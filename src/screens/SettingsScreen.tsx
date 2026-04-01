import { useEffect, useState } from "react";
import { Text, TextInput, View } from "react-native";
import { placeholderSettings } from "../presentation/placeholderSettings";
import { getAppSettings, saveAppSettings } from "../state/settingsState";
import { AppSettingsModel } from "../state/settingsTypes";
import { addStartPoint, listStartPoints, removeStartPoint, updateStartPoint } from "../state/startPoints";
import { StartPoint } from "../state/startPointTypes";
import { getTargetSettings, saveTargetSettings } from "../state/targetsState";
import { getVehicleCostSettings, saveVehicleCostSettings } from "../state/vehicleCostState";
import { daysUntil, shouldShowDueWarning } from "../utils/dueDates";
import { formatGBP } from "../utils/format";
import { Card, KeyValueRow, PrimaryButton, ScreenShell } from "./ui";

export function SettingsScreen() {
  const [settings, setSettings] = useState<AppSettingsModel | null>(null);
  const [targetHourlyInput, setTargetHourlyInput] = useState(`${placeholderSettings.targetHourly}`);
  const [targetMileInput, setTargetMileInput] = useState(`${placeholderSettings.targetPerMile}`);
  const [mpgInput, setMpgInput] = useState(`${placeholderSettings.vehicleAssumptions.mpg}`);
  const [fuelInput, setFuelInput] = useState(`${placeholderSettings.vehicleAssumptions.fuelPricePerLitre}`);
  const [maintenanceInput, setMaintenanceInput] = useState(`${placeholderSettings.vehicleAssumptions.maintenancePerMile}`);
  const [taxSavingsInput, setTaxSavingsInput] = useState(`${placeholderSettings.taxSavingsAmount}`);
  const [startPoints, setStartPoints] = useState<StartPoint[]>([]);
  const [newPostcode, setNewPostcode] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([getAppSettings(), listStartPoints(), getTargetSettings(), getVehicleCostSettings()])
      .then(([nextSettings, points, targets, vehicle]) => {
        setSettings(nextSettings);
        setStartPoints(points);
        setTargetHourlyInput(`${targets.targetHourly}`);
        setTargetMileInput(`${targets.targetPerMile}`);
        setMpgInput(`${vehicle.mpg}`);
        setFuelInput(`${vehicle.fuelPricePerLitre}`);
        setMaintenanceInput(`${vehicle.maintenancePerMile}`);
        setTaxSavingsInput(`${nextSettings.taxSavingsAmount}`);
      })
      .catch(() => {
        setSettings(null);
        setStartPoints([]);
        setSaveMessage("Couldn't load settings. Please retry.");
      });
  }, []);

  const effective =
    settings ??
    ({
      taxSavingsAmount: placeholderSettings.taxSavingsAmount,
      estimatedTaxLiability: placeholderSettings.estimatedTaxLiability,
      psvDueDate: placeholderSettings.psvDueDate,
      insuranceDueDate: placeholderSettings.insuranceDueDate,
      operatorLicenceDueDate: placeholderSettings.operatorLicenceDueDate,
      trainingHoursCompleted: placeholderSettings.trainingHoursCompleted,
      taxCorrectToDate: placeholderSettings.taxCorrectToDate,
      maxStartShiftTravelRadiusMiles: placeholderSettings.maxStartShiftTravelRadiusMiles,
    } satisfies AppSettingsModel);

  const addPoint = async () => {
    if (!newPostcode.trim()) {
      setSaveMessage("Enter a postcode before adding a start point.");
      return;
    }

    try {
      await addStartPoint({ postcode: newPostcode, label: newLabel || newPostcode });
      setStartPoints(await listStartPoints());
      setNewPostcode("");
      setNewLabel("");
      setSaveMessage("Start point saved.");
    } catch {
      setSaveMessage("Couldn't save start point right now. Try again.");
    }
  };

  const removePoint = async (id: string) => {
    try {
      await removeStartPoint(id);
      setStartPoints(await listStartPoints());
      setSaveMessage("Start point removed.");
    } catch {
      setSaveMessage("Couldn't remove that start point. Try again.");
    }
  };

  const renamePoint = async (point: StartPoint) => {
    try {
      await updateStartPoint(point.id, {
        postcode: point.postcode,
        label: `${point.label} (Updated)`,
      });
      setStartPoints(await listStartPoints());
      setSaveMessage("Start point label updated.");
    } catch {
      setSaveMessage("Couldn't update start point label. Try again.");
    }
  };

  const saveControls = async () => {
    const parsedHourly = Number(targetHourlyInput);
    const parsedMile = Number(targetMileInput);
    const parsedMpg = Number(mpgInput);
    const parsedFuel = Number(fuelInput);
    const parsedMaintenance = Number(maintenanceInput);
    const parsedTaxSavings = Number(taxSavingsInput);

    if (
      !Number.isFinite(parsedHourly) ||
      !Number.isFinite(parsedMile) ||
      !Number.isFinite(parsedMpg) ||
      !Number.isFinite(parsedFuel) ||
      !Number.isFinite(parsedMaintenance) ||
      !Number.isFinite(parsedTaxSavings)
    ) {
      setSaveMessage("Check values and use valid numbers before saving.");
      return;
    }

    try {
      await Promise.all([
        saveTargetSettings({
          targetHourly: parsedHourly,
          targetPerMile: parsedMile,
        }),
        saveVehicleCostSettings({
          mpg: parsedMpg,
          fuelPricePerLitre: parsedFuel,
          maintenancePerMile: parsedMaintenance,
        }),
        saveAppSettings({
          ...effective,
          taxSavingsAmount: parsedTaxSavings,
        }),
      ]);

      const [nextSettings, targets, vehicle] = await Promise.all([
        getAppSettings(),
        getTargetSettings(),
        getVehicleCostSettings(),
      ]);

      setSettings(nextSettings);
      setTargetHourlyInput(`${targets.targetHourly}`);
      setTargetMileInput(`${targets.targetPerMile}`);
      setMpgInput(`${vehicle.mpg}`);
      setFuelInput(`${vehicle.fuelPricePerLitre}`);
      setMaintenanceInput(`${vehicle.maintenancePerMile}`);
      setTaxSavingsInput(`${nextSettings.taxSavingsAmount}`);
      setSaveMessage("Settings saved.");
    } catch {
      setSaveMessage("Couldn't save settings right now. Try again.");
    }
  };

  return (
    <ScreenShell title="Settings" subtitle="Decision controls, compliance dates, and preferred postcode starting points.">
      <Card title="Targets (Editable)">
        <Text>Target £/hour</Text>
        <TextInput value={targetHourlyInput} onChangeText={setTargetHourlyInput} style={styles.input} keyboardType="decimal-pad" />
        <Text>Target £/mile</Text>
        <TextInput value={targetMileInput} onChangeText={setTargetMileInput} style={styles.input} keyboardType="decimal-pad" />
      </Card>

      <Card title="Vehicle Assumptions">
        <Text>MPG</Text>
        <TextInput value={mpgInput} onChangeText={setMpgInput} style={styles.input} keyboardType="decimal-pad" />
        <Text>Fuel £/L</Text>
        <TextInput value={fuelInput} onChangeText={setFuelInput} style={styles.input} keyboardType="decimal-pad" />
        <Text>Maintenance £/mile</Text>
        <TextInput value={maintenanceInput} onChangeText={setMaintenanceInput} style={styles.input} keyboardType="decimal-pad" />
        <Text>HMRC recommend setting this at 45p per mile.</Text>
        <Text>Fuel stays user-editable now and can later be refreshed from fuel receipts.</Text>
      </Card>

      <Card title="Tax + Compliance Controls">
        <Text>Tax savings amount</Text>
        <TextInput value={taxSavingsInput} onChangeText={setTaxSavingsInput} style={styles.input} keyboardType="decimal-pad" />
        <PrimaryButton label="Save controls" onPress={saveControls} />
        {saveMessage ? <Text>{saveMessage}</Text> : null}

        <KeyValueRow label="Saved tax amount" value={formatGBP(effective.taxSavingsAmount)} />
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
          How far are you prepared to travel to start your shift? Used when checking whether a nearby area would be a better place to begin working.
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
        <TextInput value={newPostcode} onChangeText={setNewPostcode} style={styles.input} placeholder="Postcode (e.g. BT7)" />
        <TextInput value={newLabel} onChangeText={setNewLabel} style={styles.input} placeholder="Optional label" />
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