import {
  Badge,
  Box,
  Button,
  Card,
  Heading,
  IconButton,
  Modal,
  Page,
  Spinner,
  Text,
  TextField,
} from "@terreno/ui";
import {DateTime} from "luxon";
import type React from "react";
import {useCallback, useMemo, useState} from "react";
import {FlatList, Pressable} from "react-native";
import {
  type Reminder,
  useAppleSyncNowMutation,
  useCompleteReminderMutation,
  useCreateReminderMutation,
  useListReminderListsQuery,
  useListRemindersQuery,
  useRemoveReminderMutation,
} from "@/store/sdk";

interface AddReminderFormState {
  title: string;
  listName: string;
  dueDate: string;
  notes: string;
}

const emptyForm: AddReminderFormState = {title: "", listName: "", dueDate: "", notes: ""};

const formatDueDate = (dueDate?: string): string | null => {
  if (!dueDate) {
    return null;
  }
  const due = DateTime.fromISO(dueDate);
  if (!due.isValid) {
    return null;
  }
  // All-day due dates sync as local midnight — show just the day for those.
  const isMidnight = due.hour === 0 && due.minute === 0;
  return isMidnight ? due.toFormat("ccc, MMM d") : due.toFormat("ccc, MMM d 'at' h:mm a");
};

const isOverdue = (dueDate?: string): boolean => {
  if (!dueDate) {
    return false;
  }
  const due = DateTime.fromISO(dueDate);
  return due.isValid && due < DateTime.now().startOf("day");
};

const RemindersScreen: React.FC = () => {
  const {data: listsData} = useListReminderListsQuery();
  const [selectedList, setSelectedList] = useState<string | null>(null);
  const {data, isLoading, refetch} = useListRemindersQuery(
    selectedList ? {listName: selectedList, completed: false} : {completed: false}
  );
  const [createReminder, {isLoading: isCreating}] = useCreateReminderMutation();
  const [completeReminder] = useCompleteReminderMutation();
  const [removeReminder] = useRemoveReminderMutation();
  const [syncNow, {isLoading: isSyncing}] = useAppleSyncNowMutation();
  const [modalVisible, setModalVisible] = useState(false);
  const [form, setForm] = useState<AddReminderFormState>(emptyForm);

  const lists = listsData?.results || [];
  const reminders = useMemo(() => {
    const results = data?.results || [];
    // Due-dated reminders first (soonest on top), then the dateless ones.
    return [...results].sort((a, b) => {
      if (a.dueDate && b.dueDate) {
        return a.dueDate.localeCompare(b.dueDate);
      }
      if (a.dueDate) {
        return -1;
      }
      if (b.dueDate) {
        return 1;
      }
      return a.title.localeCompare(b.title);
    });
  }, [data]);

  const handleOpenAdd = useCallback((): void => {
    setForm({...emptyForm, listName: selectedList ?? ""});
    setModalVisible(true);
  }, [selectedList]);

  const handleDismissAdd = useCallback((): void => {
    setModalVisible(false);
  }, []);

  const handleFormChange = useCallback(
    (field: keyof AddReminderFormState) =>
      (value: string): void => {
        setForm((prev) => ({...prev, [field]: value}));
      },
    []
  );

  const handleSubmitAdd = useCallback(async (): Promise<void> => {
    const title = form.title.trim();
    if (!title) {
      return;
    }
    await createReminder({
      title,
      listName: form.listName.trim() || undefined,
      dueDate: form.dueDate.trim() || undefined,
      notes: form.notes.trim() || undefined,
    });
    setModalVisible(false);
  }, [createReminder, form]);

  const handleComplete = useCallback(
    (reminder: Reminder): void => {
      completeReminder(reminder._id);
    },
    [completeReminder]
  );

  const handleRemove = useCallback(
    (reminder: Reminder): void => {
      removeReminder(reminder._id);
    },
    [removeReminder]
  );

  const handleSync = useCallback(async (): Promise<void> => {
    await syncNow();
    refetch();
  }, [syncNow, refetch]);

  const renderReminder = useCallback(
    ({item}: {item: Reminder}) => {
      const due = formatDueDate(item.dueDate);
      return (
        <Card testID={`reminders-item-${item._id}`}>
          <Box padding={3} gap={2} direction="row" justifyContent="between" alignItems="center">
            <Box gap={1} flex="grow">
              <Text bold>{item.title}</Text>
              <Box direction="row" gap={2} alignItems="center">
                <Text color="secondaryLight" size="sm">
                  {item.listName}
                </Text>
                {due && (
                  <Badge
                    testID={`reminders-item-${item._id}-due`}
                    status={isOverdue(item.dueDate) ? "error" : "info"}
                    value={due}
                  />
                )}
              </Box>
              {item.notes ? (
                <Text color="secondaryLight" size="sm">
                  {item.notes}
                </Text>
              ) : null}
            </Box>
            <Box direction="row" gap={2}>
              <IconButton
                testID={`reminders-item-${item._id}-complete`}
                accessibilityLabel="Complete reminder"
                iconName="check"
                onClick={() => handleComplete(item)}
              />
              <IconButton
                testID={`reminders-item-${item._id}-delete`}
                accessibilityLabel="Delete reminder"
                iconName="trash"
                variant="destructive"
                onClick={() => handleRemove(item)}
              />
            </Box>
          </Box>
        </Card>
      );
    },
    [handleComplete, handleRemove]
  );

  if (isLoading) {
    return (
      <Page navigation={undefined} title="Reminders">
        <Box padding={4} alignItems="center" testID="reminders-screen">
          <Box testID="reminders-loading-spinner">
            <Spinner />
          </Box>
        </Box>
      </Page>
    );
  }

  const canSubmit = form.title.trim().length > 0;

  return (
    <Page navigation={undefined} title="Reminders">
      <Box padding={4} gap={4} testID="reminders-screen">
        <Box direction="row" justifyContent="between" alignItems="center">
          <Heading>Reminders</Heading>
          <Box direction="row" gap={2}>
            <Button
              testID="reminders-sync-button"
              text={isSyncing ? "Syncing..." : "Sync"}
              variant="outline"
              onClick={handleSync}
            />
            <Button testID="reminders-add-button" text="Add Reminder" onClick={handleOpenAdd} />
          </Box>
        </Box>

        {lists.length > 0 && (
          <Box direction="row" gap={2} wrap testID="reminders-list-filters">
            <Pressable testID="reminders-filter-all" onPress={() => setSelectedList(null)}>
              <Badge status={selectedList === null ? "info" : "neutral"} value="All" />
            </Pressable>
            {lists.map((list) => (
              <Pressable
                key={list._id}
                testID={`reminders-filter-${list._id}`}
                onPress={() => setSelectedList(list.name)}
              >
                <Badge status={selectedList === list.name ? "info" : "neutral"} value={list.name} />
              </Pressable>
            ))}
          </Box>
        )}

        {reminders.length === 0 ? (
          <Box testID="reminders-empty-state" padding={8} alignItems="center">
            <Text color="secondaryLight">
              {selectedList ? `No open reminders in ${selectedList}.` : "No open reminders."}
            </Text>
          </Box>
        ) : (
          <FlatList
            testID="reminders-list"
            data={reminders}
            renderItem={renderReminder}
            keyExtractor={(item) => item._id}
            contentContainerStyle={{gap: 12}}
          />
        )}

        <Modal
          visible={modalVisible}
          title="Add Reminder"
          subtitle="Created in Apple Reminders on the Mac via the edge agent."
          primaryButtonText={isCreating ? "Adding..." : "Add Reminder"}
          primaryButtonDisabled={!canSubmit || isCreating}
          secondaryButtonText="Cancel"
          primaryButtonOnClick={handleSubmitAdd}
          secondaryButtonOnClick={handleDismissAdd}
          onDismiss={handleDismissAdd}
        >
          <Box gap={3} testID="reminders-add-modal">
            <TextField
              testID="reminders-add-title"
              title="Title"
              value={form.title}
              onChange={handleFormChange("title")}
            />
            <TextField
              testID="reminders-add-list"
              title="List"
              helperText={
                lists.length > 0
                  ? `Optional. One of: ${lists.map((l) => l.name).join(", ")}`
                  : "Optional. Uses the default list when blank."
              }
              value={form.listName}
              onChange={handleFormChange("listName")}
            />
            <TextField
              testID="reminders-add-due"
              title="Due date"
              helperText="Optional. '2026-07-20' for all day, or '2026-07-20T09:00' for a time."
              value={form.dueDate}
              onChange={handleFormChange("dueDate")}
            />
            <TextField
              testID="reminders-add-notes"
              title="Notes"
              helperText="Optional."
              value={form.notes}
              onChange={handleFormChange("notes")}
            />
          </Box>
        </Modal>
      </Box>
    </Page>
  );
};

// Expo Router requires default export for route files
export default RemindersScreen;
