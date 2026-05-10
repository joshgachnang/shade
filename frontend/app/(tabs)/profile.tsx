import {Box, Button, Heading, Page, Text, TextField} from "@terreno/ui";
import {useRouter} from "expo-router";
import type React from "react";
import {useCallback, useEffect, useState} from "react";
import {logout, useAppDispatch, useGetMeQuery, usePatchMeMutation} from "@/store";

const ProfileScreen: React.FC = () => {
  const router = useRouter();
  const dispatch = useAppDispatch();
  const {data: profile, isLoading} = useGetMeQuery();
  const [patchMe, {isLoading: isSaving}] = usePatchMeMutation();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [isDirty, setIsDirty] = useState(false);

  useEffect(() => {
    if (profile?.data) {
      setName(profile.data.name || "");
      setEmail(profile.data.email || "");
    }
  }, [profile?.data]);

  const handleNameChange = useCallback((value: string) => {
    setName(value);
    setIsDirty(true);
  }, []);

  const handleEmailChange = useCallback((value: string) => {
    setEmail(value);
    setIsDirty(true);
  }, []);

  const handleSave = useCallback(async () => {
    await patchMe({name, email});
    setIsDirty(false);
  }, [patchMe, name, email]);

  const handleLogout = useCallback((): void => {
    dispatch(logout());
  }, [dispatch]);

  const handleOpenAdmin = useCallback((): void => {
    router.push("/admin");
  }, [router]);

  if (isLoading) {
    return (
      <Page navigation={undefined} title="Profile">
        <Box padding={4} testID="profile-screen">
          <Text testID="profile-loading">Loading...</Text>
        </Box>
      </Page>
    );
  }

  return (
    <Page navigation={undefined} title="Profile">
      <Box padding={4} gap={4} testID="profile-screen">
        <Heading>Profile</Heading>
        <TextField
          label="Name"
          value={name}
          onChangeText={handleNameChange}
          testID="profile-name-input"
        />
        <TextField
          label="Email"
          value={email}
          onChangeText={handleEmailChange}
          testID="profile-email-input"
        />
        {isDirty && (
          <Button
            fullWidth
            onClick={handleSave}
            disabled={isSaving}
            testID="profile-save-button"
            text={isSaving ? "Saving..." : "Save"}
          />
        )}
        {profile?.data?.admin === true && (
          <Box marginTop={4}>
            <Button
              fullWidth
              onClick={handleOpenAdmin}
              testID="profile-admin-button"
              text="Admin"
            />
          </Box>
        )}
        <Box marginTop={4}>
          <Button
            onClick={handleLogout}
            testID="profile-logout-button"
            text="Logout"
            variant="outline"
            fullWidth
          />
        </Box>
      </Box>
    </Page>
  );
};

// Expo Router requires default export for route files
export default ProfileScreen;
