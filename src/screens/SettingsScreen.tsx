import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Text, TextInput, View } from "react-native";
import { getLatestImportSummary } from "../engines/import/importPersistence";
import { placeholderSettings } from "../presentation/placeholderSettings";
import { getAppSettings, saveAppSettings } from "../state/settingsState";
import { AppSettingsModel } from "../state/settingsTypes";
import { addStartPoint, listStartPoints, removeStartPoint, updateStartPoint } from "../state/startPoints";
import { StartPoint } from "../state/startPointTypes";
import { getTargetSettings, saveTargetSettings } from "../state/targetsState";
import { getVehicleCostSettings, saveVehicleCostSettings } from "../state/vehicleCostState";
import { formatGBP, formatUkDate } from "../utils/format";
import { Card, KeyValueRow, PrimaryButton, ScreenShell } from "./ui";

export function SettingsScreen() {
  const router = useRouter();
  const [settings, setSettings] = useState<AppSettingsModel | null>(null);
  const [targetHourlyInput, setTargetHourlyInput] = useState(`${placeholderSettings.targetHourly}`);
  const [targetMileInput, setTargetMileInput] = useState(`${placeholderSettings.targetPerMile}`);
  const [mpgInput, setMpgInput] = useState(`${placeholderSettings.vehicleAssumptions.mpg}`);
  const [fuelInput, setFuelInput] = useState(`${placeholderSettings.vehicleAssumptions.fuelPricePerLitre}`);
  const [maintenanceInput, setMaintenanceInput] = useState(`${placeholderSettings.vehicleAssumptions.maintenancePerMile}`);
  const [taxSavingsInput, setTaxSavingsInput] = useState(`${placeholderSettings.taxSavingsAmount}`);
  const [radiusInput, setRadiusInput] = useState(`${placeholderSettings.maxStartShiftTravelRadiusMiles}`);
  const [psvDueDateInput, setPsvDueDateInput] = useState(placeholderSettings.psvDueDate ?? "");
  const [insuranceDueDateInput, setInsuranceDueDateInput] = useState(placeholderSettings.insuranceDueDate ?? "");
  const [operatorDueDateInput, setOperatorDueDateInput] = useState(placeholderSettings.operatorLicenceDueDate ?? "");
  const [trainingHoursInput, setTrainingHoursInput] = useState(`${placeholderSettings.trainingHoursCompleted}`);
  const [startPoints, setStartPoints] = useState<StartPoint[]>([]);
  const [newPostcode, setNewPostcode] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [latestImportAt, setLatestImportAt] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([getAppSettings(), listStartPoints(), getTargetSettings(), getVehicleCostSettings(), getLatestImportSummary()])
      .then(([nextSettings, points, targets, vehicle, importSummary]) => {
        setSettings(nextSettings);
        setStartPoints(points);
        setTargetHourlyInput(`${targets.targetHourly}`);
        setTargetMileInput(`${targets.targetPerMile}`);
        setMpgInput(`${vehicle.mpg}`);
        setFuelInput(`${vehicle.fuelPricePerLitre}`);
        setMaintenanceInput(`${vehicle.maintenancePerMile}`);
        setTaxSavingsInput(`${nextSettings.taxSavingsAmount}`);
        setRadiusInput(`${nextSettings.maxStartShiftTravelRadiusMiles}`);
        setPsvDueDateInput(nextSettings.psvDueDate ?? "");
        setInsuranceDueDateInput(nextSettings.insuranceDueDate ?? "");
        setOperatorDueDateInput(nextSettings.operatorLicenceDueDate ?? "");
        setTrainingHoursInput(`${nextSettings.trainingHoursCompleted.toFixed(2)}`);
        setLatestImportAt(importSummary?.importedAt ?? null);
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
      vehicleExpenseMethod: "simplified_mileage",
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
    const parsedTraining = Number(trainingHoursInput);

    if (
      !Number.isFinite(parsedHourly) ||
      !Number.isFinite(parsedMile) ||
      !Number.isFinite(parsedMpg) ||
      !Number.isFinite(parsedFuel) ||
      !Number.isFinite(parsedMaintenance) ||
      !Number.isFinite(parsedTaxSavings) ||
      !Number.isFinite(parsedRadius) ||
      !Number.isFinite(parsedTraining)
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
          psvDueDate: psvDueDateInput.trim() || null,
          insuranceDueDate: insuranceDueDateInput.trim() || null,
          operatorLicenceDueDate: operatorDueDateInput.trim() || null,
          trainingHoursCompleted: Math.round(parsedTraining * 100) / 100,
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
      setPsvDueDateInput(nextSettings.psvDueDate ?? "");
      setInsuranceDueDateInput(nextSettings.insuranceDueDate ?? "");
      setOperatorDueDateInput(nextSettings.operatorLicenceDueDate ?? "");
      setTrainingHoursInput(`${nextSettings.trainingHoursCompleted.toFixed(2)}`);
      setSaveMessage("Settings saved.");
    } catch {
      setSaveMessage("Couldn't save settings right now. Try again.");
    }
  };

  return (
    <ScreenShell title="Settings" subtitle="Decision controls, Favourites, compliance details, and privacy upload.">
      <Card title="Targets (Editable)">
        <Text>Target GBP/hour</Text>
        <TextInput value={targetHourlyInput} onChangeText={setTargetHourlyInput} style={styles.input} keyboardType="decimal-pad" />
        <Text>Target GBP/mile</Text>
        <TextInput value={targetMileInput} onChangeText={setTargetMileInput} style={styles.input} keyboardType="decimal-pad" />
      </Card>

      <Card title="Start Preferences">
        <Text>Max start-shift travel radius (miles)</Text>
        <TextInput value={radiusInput} onChangeText={setRadiusInput} style={styles.input} keyboardType="decimal-pad" />
        <Text>Used when checking whether a nearby area would be a better place to begin working.</Text>
      </Card>

      <Card title="Favourites">
        <Text>Set the postcodes you prefer to work from or return to between jobs.</Text>
        <Text>These are used when comparing nearby areas and start-of-shift suggestions.</Text>
        <Text>While online, favourites may be monitored for unusually busy periods and proximity alerts.</Text>
        <Text>They also anchor Smart Diary opportunity and disruption planning windows.</Text>
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

      <Card title="Vehicle Assumptions">
        <Text>MPG</Text>
        <TextInput value={mpgInput} onChangeText={setMpgInput} style={styles.input} keyboardType="decimal-pad" />
        <Text>Fuel GBP/L</Text>
        <TextInput value={fuelInput} onChangeText={setFuelInput} style={styles.input} keyboardType="decimal-pad" />
        <Text>Maintenance GBP/mile</Text>
        <TextInput value={maintenanceInput} onChangeText={setMaintenanceInput} style={styles.input} keyboardType="decimal-pad" />
        <Text>HMRC recommend setting this at 45p per mile.</Text>
        <Text>Fuel stays user-editable now and can later be refreshed from fuel receipts.</Text>
      </Card>

      <Card title="Tax">
        <Text>Tax savings amount</Text>
        <TextInput value={taxSavingsInput} onChangeText={setTaxSavingsInput} style={styles.input} keyboardType="decimal-pad" />
        <KeyValueRow label="Saved tax amount" value={formatGBP(effective.taxSavingsAmount)} />
        <KeyValueRow label="Estimated tax liability" value={formatGBP(effective.estimatedTaxLiability)} />
        <KeyValueRow label="Tax correct to" value={formatUkDate(effective.taxCorrectToDate)} />
      </Card>

      <Card title="Compliance">
        <Text>PSV due date (YYYY-MM-DD)</Text>
        <TextInput value={psvDueDateInput} onChangeText={setPsvDueDateInput} style={styles.input} />
        <Text>{`Display: ${formatUkDate(psvDueDateInput || null)}`}</Text>

        <Text>Insurance due date (YYYY-MM-DD)</Text>
        <TextInput value={insuranceDueDateInput} onChangeText={setInsuranceDueDateInput} style={styles.input} />
        <Text>{`Display: ${formatUkDate(insuranceDueDateInput || null)}`}</Text>

        <Text>Operator licence expiry (YYYY-MM-DD)</Text>
        <TextInput value={operatorDueDateInput} onChangeText={setOperatorDueDateInput} style={styles.input} />
        <Text>{`Display: ${formatUkDate(operatorDueDateInput || null)}`}</Text>

        <Text>Training hours completed</Text>
        <TextInput value={trainingHoursInput} onChangeText={setTrainingHoursInput} style={styles.input} keyboardType="decimal-pad" />
        <Text>{`Saved to 2dp: ${(Number(trainingHoursInput) || 0).toFixed(2)}`}</Text>
      </Card>

      <Card title="Privacy Upload">
        <Text>Upload your latest privacy file from here when you are ready to refresh decisions.</Text>
        <PrimaryButton label="Open upload" onPress={() => router.push("/upload")} />
        <Text>{`Latest import: ${latestImportAt ? formatUkDate(latestImportAt) : "No imports yet"}`}</Text>
      </Card>

      <Card title="Expenses">
        <Text>Review saved expenses and sync state.</Text>
        <PrimaryButton label="Open expenses history" onPress={() => router.push("/expenses/history")} />
      </Card>

      <Card title="Save">
        <PrimaryButton label="Save controls" onPress={saveControls} />
        {saveMessage ? <Text>{saveMessage}</Text> : null}
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


