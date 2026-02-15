import {Box, Button, Heading, Page, Text} from "@terreno/ui";
import type React from "react";
import {useCallback} from "react";
import {logout, useGetMeQuery} from "@/store";
import {useAppDispatch} from "@/store";

const ProfileScreen: React.FC = () => {
  const dispatch = useAppDispatch();
  const {data: profile, isLoading} = useGetMeQuery();

  const handleLogout = useCallback((): void => {
    dispatch(logout());
  }, [dispatch]);

  if (isLoading) {
    return (
      <Page navigation={undefined} title="Profile">
        <Box padding={4}>
          <Text>Loading...</Text>
        </Box>
      </Page>
    );
  }

  return (
    <Page navigation={undefined} title="Profile">
      <Box padding={4} gap={4}>
        <Heading>Profile</Heading>
        <Box gap={2}>
          <Text weight="bold">Name</Text>
          <Text>{profile?.data?.name || "Not set"}</Text>
        </Box>
        <Box gap={2}>
          <Text weight="bold">Email</Text>
          <Text>{profile?.data?.email || "Not set"}</Text>
        </Box>
        <Box marginTop={4}>
          <Button onClick={handleLogout} text="Logout" variant="outline" fullWidth />
        </Box>
      </Box>
    </Page>
  );
};

export default ProfileScreen;
