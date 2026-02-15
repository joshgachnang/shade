import FontAwesome from "@expo/vector-icons/FontAwesome";
import {Tabs} from "expo-router";
import type React from "react";
import {useCallback} from "react";
import {colors} from "@/constants/theme";

const TabBarIcon: React.FC<{
  name: React.ComponentProps<typeof FontAwesome>["name"];
  color: string;
}> = ({name, color}) => {
  return <FontAwesome color={color} name={name} size={24} style={{marginBottom: -3}} />;
};

const TabLayout: React.FC = () => {
  const renderHomeIcon = useCallback(
    ({color}: {color: string}): React.ReactElement => <TabBarIcon color={color} name="home" />,
    []
  );

  const renderProfileIcon = useCallback(
    ({color}: {color: string}): React.ReactElement => <TabBarIcon color={color} name="user" />,
    []
  );

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.tint,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          tabBarIcon: renderHomeIcon,
          title: "Home",
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          headerShown: false,
          tabBarIcon: renderProfileIcon,
          title: "Profile",
        }}
      />
    </Tabs>
  );
};

// Expo Router requires default export for route files
export default TabLayout;
