import {Box, Button, Heading, Page, Text} from "@terreno/ui";
import type React from "react";
import {useCallback} from "react";
import {logout, useAppDispatch, useGetMeQuery} from "@/store";

const ProfileScreen: React.FC = () => {
  const dispatch = useAppDispatch();
  const {data: profile, isLoading} = useGetMeQuery();

  const handleLogout = useCallback((): void => {
    dispatch(logout());
  }, [dispatch]);

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
        <Box gap={2}>
          <Text bold>Name</Text>
          <Text testID="profile-name-text">{profile?.data?.name || "Not set"}</Text>
        </Box>
        <Box gap={2}>
          <Text bold>Email</Text>
          <Text testID="profile-email-text">{profile?.data?.email || "Not set"}</Text>
        </Box>
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
