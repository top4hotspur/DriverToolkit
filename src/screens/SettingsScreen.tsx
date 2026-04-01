import { useEffect, useState } from "react";
import { Text, TextInput, View } from "react-native";
import { placeholderSettings } from "../presentation/placeholderSettings";
import { getAppSettings, saveAppSettings } from "../state/settingsState";
import { AppSettingsModel } from "../state/settingsTypes";
import { addStartPoint, listStartPoints, removeStartPoint, updateStartPoint } from "../state/startPoints";
import { StartPoint } from "../state/startPointTypes";
import { getTargetSettings, saveTargetSettings } from "../state/targetsState";
import { getVehicleCostSettings, saveVehicleCostSettings } from "../state/vehicleCostState";
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
  const [radiusInput, setRadiusInput] = useState(`${placeholderSettings.maxStartShiftTravelRadiusMiles}`);
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
        setRadiusInput(`${nextSettings.maxStartShiftTravelRadiusMiles}`);
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
      setSaveMessage("Enter a postcode before adding a favourite.");
      return;
    }

    try {
      await addStartPoint({ postcode: newPostcode, label: newLabel || newPostcode });
      setStartPoints(await listStartPoints());
      setNewPostcode("");
      setNewLabel("");
      setSaveMessage("Favourite saved.");
    } catch {
      setSaveMessage("Couldn't save favourite right now. Try again.");
    }
  };

  const removePoint = async (id: string) => {
    try {
      await removeStartPoint(id);
      setStartPoints(await listStartPoints());
      setSaveMessage("Favourite removed.");
    } catch {
      setSaveMessage("Couldn't remove that favourite. Try again.");
    }
  };

  const renamePoint = async (point: StartPoint) => {
    try {
      await updateStartPoint(point.id, {
        postcode: point.postcode,
        label: `${point.label} (Updated)`,
      });
      setStartPoints(await listStartPoints());
      setSaveMessage("Favourite label updated.");
    } catch {
      setSaveMessage("Couldn't update favourite label. Try again.");
    }
  };

  const saveControls = async () => {
    const parsedHourly = Number(targetHourlyInput);
    const parsedMile = Number(targetMileInput);
    const parsedMpg = Number(mpgInput);
    const parsedFuel = Number(fuelInput);
    const parsedMaintenance = Number(maintenanceInput);
    const parsedTaxSavings = Number(taxSavingsInput);
    const parsedRadius = Number(radiusInput);

    if (
      !Number.isFinite(parsedHourly) ||
      !Number.isFinite(parsedMile) ||
      !Number.isFinite(parsedMpg) ||
      !Number.isFinite(parsedFuel) ||
      !Number.isFinite(parsedMaintenance) ||
      !Number.isFinite(parsedTaxSavings) ||
      !Number.isFinite(parsedRadius)
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
          maxStartShiftTravelRadiusMiles: parsedRadius,
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
      setRadiusInput(`${nextSettings.maxStartShiftTravelRadiusMiles}`);
      setSaveMessage("Settings saved.");
    } catch {
      setSaveMessage("Couldn't save settings right now. Try again.");
    }
  };

  return (
    <ScreenShell title="Settings" subtitle="Decision controls, Favourites, and compliance details.">
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

      <Card title="Start Preferences">
        <Text>Max start-shift travel radius (miles)</Text>
        <TextInput value={radiusInput} onChangeText={setRadiusInput} style={styles.input} keyboardType="decimal-pad" />
        <Text>Used when checking whether a nearby area would be a better place to begin working.</Text>
      </Card>

      <Card title="Tax">
        <Text>Tax savings amount</Text>
        <TextInput value={taxSavingsInput} onChangeText={setTaxSavingsInput} style={styles.input} keyboardType="decimal-pad" />
        <PrimaryButton label="Save controls" onPress={saveControls} />
        {saveMessage ? <Text>{saveMessage}</Text> : null}
        <KeyValueRow label="Saved tax amount" value={formatGBP(effective.taxSavingsAmount)} />
        <KeyValueRow label="Estimated tax liability" value={formatGBP(effective.estimatedTaxLiability)} />
        <KeyValueRow label="Tax correct to" value={effective.taxCorrectToDate ?? "Not set"} />
      </Card>

      <Card title="Compliance">
        <KeyValueRow label="PSV due date" value={effective.psvDueDate ?? "Not set"} />
        <KeyValueRow label="Insurance due date" value={effective.insuranceDueDate ?? "Not set"} />
        <KeyValueRow label="Operator licence expiry" value={effective.operatorLicenceDueDate ?? "Not set"} />
        <KeyValueRow label="Training hours completed" value={effective.trainingHoursCompleted.toFixed(2)} />
      </Card>

      <Card title="Favourites">
        <Text>Set the postcodes you prefer to work from or return to between jobs.</Text>
        <Text>These are used when comparing nearby areas and start-of-shift suggestions.</Text>
        <TextInput value={newPostcode} onChangeText={setNewPostcode} style={styles.input} placeholder="Postcode (e.g. BT6 9LF)" />
        <TextInput value={newLabel} onChangeText={setNewLabel} style={styles.input} placeholder="Optional label" />
        <PrimaryButton label="Add favourite" onPress={addPoint} />

        {startPoints.length === 0 ? (
          <Text>Add at least one favourite to power start-of-shift comparison.</Text>
        ) : (
          startPoints.map((point) => (
            <View key={point.id} style={styles.pointRow}>
              <Text>{`${point.postcode} (${point.outwardCode ?? "N/A"}) - ${point.label}`}</Text>
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