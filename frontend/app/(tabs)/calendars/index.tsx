import {
  Badge,
  Box,
  Button,
  Card,
  Heading,
  Modal,
  Page,
  Spinner,
  Text,
  TextField,
} from "@terreno/ui";
import {DateTime} from "luxon";
import type React from "react";
import {useCallback, useMemo, useState} from "react";
import {Pressable, SectionList} from "react-native";
import {
  type CalendarEvent,
  useAppleSyncNowMutation,
  useCreateCalendarEventMutation,
  useListAppleCalendarsQuery,
  useListCalendarEventsQuery,
} from "@/store/sdk";

interface AddEventFormState {
  title: string;
  calendarName: string;
  startDate: string;
  endDate: string;
  location: string;
}

const emptyForm: AddEventFormState = {
  title: "",
  calendarName: "",
  startDate: "",
  endDate: "",
  location: "",
};

interface DaySection {
  title: string;
  data: CalendarEvent[];
}

const formatEventTime = (event: CalendarEvent): string => {
  if (event.allDay) {
    return "All day";
  }
  const start = DateTime.fromISO(event.startDate);
  const end = DateTime.fromISO(event.endDate);
  if (!start.isValid || !end.isValid) {
    return "";
  }
  return `${start.toFormat("h:mm a")} – ${end.toFormat("h:mm a")}`;
};

const groupEventsByDay = (events: CalendarEvent[]): DaySection[] => {
  const startOfToday = DateTime.now().startOf("day");
  const byDay = new Map<string, CalendarEvent[]>();

  for (const event of events) {
    const start = DateTime.fromISO(event.startDate);
    if (!start.isValid || start.endOf("day") < startOfToday) {
      continue;
    }
    const key = start.toISODate() ?? "";
    const bucket = byDay.get(key);
    if (bucket) {
      bucket.push(event);
    } else {
      byDay.set(key, [event]);
    }
  }

  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, dayEvents]) => ({
      title: DateTime.fromISO(day).toFormat("cccc, MMMM d"),
      data: dayEvents.sort((a, b) => a.startDate.localeCompare(b.startDate)),
    }));
};

const CalendarsScreen: React.FC = () => {
  const {data: calendarsData} = useListAppleCalendarsQuery();
  const [selectedCalendar, setSelectedCalendar] = useState<string | null>(null);
  const {data, isLoading, refetch} = useListCalendarEventsQuery(
    selectedCalendar ? {calendarName: selectedCalendar} : undefined
  );
  const [createEvent, {isLoading: isCreating}] = useCreateCalendarEventMutation();
  const [syncNow, {isLoading: isSyncing}] = useAppleSyncNowMutation();
  const [modalVisible, setModalVisible] = useState(false);
  const [form, setForm] = useState<AddEventFormState>(emptyForm);

  const calendars = calendarsData?.results || [];
  const sections = useMemo(() => groupEventsByDay(data?.results || []), [data]);

  const handleOpenAdd = useCallback((): void => {
    setForm({...emptyForm, calendarName: selectedCalendar ?? ""});
    setModalVisible(true);
  }, [selectedCalendar]);

  const handleDismissAdd = useCallback((): void => {
    setModalVisible(false);
  }, []);

  const handleFormChange = useCallback(
    (field: keyof AddEventFormState) =>
      (value: string): void => {
        setForm((prev) => ({...prev, [field]: value}));
      },
    []
  );

  const handleSubmitAdd = useCallback(async (): Promise<void> => {
    const title = form.title.trim();
    const startDate = form.startDate.trim();
    const endDate = form.endDate.trim();
    if (!title || !startDate || !endDate) {
      return;
    }
    // Bare dates (no time part) create an all-day event.
    const allDay = !startDate.includes("T");
    await createEvent({
      title,
      calendarName: form.calendarName.trim() || undefined,
      startDate,
      endDate,
      allDay,
      location: form.location.trim() || undefined,
    });
    setModalVisible(false);
  }, [createEvent, form]);

  const handleSync = useCallback(async (): Promise<void> => {
    await syncNow();
    refetch();
  }, [syncNow, refetch]);

  const renderEvent = useCallback(({item}: {item: CalendarEvent}) => {
    return (
      <Card testID={`calendars-item-${item._id}`}>
        <Box padding={3} gap={1}>
          <Box direction="row" justifyContent="between" alignItems="center">
            <Text bold>{item.title}</Text>
            <Badge status="neutral" value={item.calendarName} />
          </Box>
          <Text color="secondaryLight" size="sm" testID={`calendars-item-${item._id}-time`}>
            {formatEventTime(item)}
          </Text>
          {item.location ? (
            <Text color="secondaryLight" size="sm">
              {item.location}
            </Text>
          ) : null}
        </Box>
      </Card>
    );
  }, []);

  if (isLoading) {
    return (
      <Page navigation={undefined} title="Calendar">
        <Box padding={4} alignItems="center" testID="calendars-screen">
          <Box testID="calendars-loading-spinner">
            <Spinner />
          </Box>
        </Box>
      </Page>
    );
  }

  const canSubmit =
    form.title.trim().length > 0 &&
    form.startDate.trim().length > 0 &&
    form.endDate.trim().length > 0;

  return (
    <Page navigation={undefined} title="Calendar">
      <Box padding={4} gap={4} testID="calendars-screen">
        <Box direction="row" justifyContent="between" alignItems="center">
          <Heading>Calendar</Heading>
          <Box direction="row" gap={2}>
            <Button
              testID="calendars-sync-button"
              text={isSyncing ? "Syncing..." : "Sync"}
              variant="outline"
              onClick={handleSync}
            />
            <Button testID="calendars-add-button" text="Add Event" onClick={handleOpenAdd} />
          </Box>
        </Box>

        {calendars.length > 0 && (
          <Box direction="row" gap={2} wrap testID="calendars-filters">
            <Pressable testID="calendars-filter-all" onPress={() => setSelectedCalendar(null)}>
              <Badge status={selectedCalendar === null ? "info" : "neutral"} value="All" />
            </Pressable>
            {calendars.map((calendar) => (
              <Pressable
                key={calendar._id}
                testID={`calendars-filter-${calendar._id}`}
                onPress={() => setSelectedCalendar(calendar.name)}
              >
                <Badge
                  status={selectedCalendar === calendar.name ? "info" : "neutral"}
                  value={calendar.name}
                />
              </Pressable>
            ))}
          </Box>
        )}

        {sections.length === 0 ? (
          <Box testID="calendars-empty-state" padding={8} alignItems="center">
            <Text color="secondaryLight">
              {selectedCalendar
                ? `No upcoming events in ${selectedCalendar}.`
                : "No upcoming events."}
            </Text>
          </Box>
        ) : (
          <SectionList
            testID="calendars-list"
            sections={sections}
            renderItem={renderEvent}
            renderSectionHeader={({section}) => (
              <Box paddingY={2}>
                <Heading size="sm">{(section as DaySection).title}</Heading>
              </Box>
            )}
            keyExtractor={(item) => item._id}
            contentContainerStyle={{gap: 8}}
            stickySectionHeadersEnabled={false}
          />
        )}

        <Modal
          visible={modalVisible}
          title="Add Event"
          subtitle="Created in Apple Calendar on the Mac via the edge agent."
          primaryButtonText={isCreating ? "Adding..." : "Add Event"}
          primaryButtonDisabled={!canSubmit || isCreating}
          secondaryButtonText="Cancel"
          primaryButtonOnClick={handleSubmitAdd}
          secondaryButtonOnClick={handleDismissAdd}
          onDismiss={handleDismissAdd}
        >
          <Box gap={3} testID="calendars-add-modal">
            <TextField
              testID="calendars-add-title"
              title="Title"
              value={form.title}
              onChange={handleFormChange("title")}
            />
            <TextField
              testID="calendars-add-calendar"
              title="Calendar"
              helperText={
                calendars.length > 0
                  ? `Optional. One of: ${calendars
                      .filter((c) => c.writable)
                      .map((c) => c.name)
                      .join(", ")}`
                  : "Optional. Uses the default calendar when blank."
              }
              value={form.calendarName}
              onChange={handleFormChange("calendarName")}
            />
            <TextField
              testID="calendars-add-start"
              title="Starts"
              helperText="'2026-07-20T09:00' or '2026-07-20' for all day."
              value={form.startDate}
              onChange={handleFormChange("startDate")}
            />
            <TextField
              testID="calendars-add-end"
              title="Ends"
              helperText="'2026-07-20T10:00' or '2026-07-20' for all day."
              value={form.endDate}
              onChange={handleFormChange("endDate")}
            />
            <TextField
              testID="calendars-add-location"
              title="Location"
              helperText="Optional."
              value={form.location}
              onChange={handleFormChange("location")}
            />
          </Box>
        </Modal>
      </Box>
    </Page>
  );
};

// Expo Router requires default export for route files
export default CalendarsScreen;
