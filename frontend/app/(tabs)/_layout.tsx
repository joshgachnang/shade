import FontAwesome from "@expo/vector-icons/FontAwesome";
import {Tabs} from "expo-router";
import type React from "react";
import {useCallback} from "react";
import {colors} from "@/constants/theme";
import {useGetMeQuery} from "@/store";

const TabBarIcon: React.FC<{
  name: React.ComponentProps<typeof FontAwesome>["name"];
  color: string;
}> = ({name, color}) => {
  return <FontAwesome color={color} name={name} size={24} style={{marginBottom: -3}} />;
};

const TabLayout: React.FC = () => {
  const {data: me} = useGetMeQuery();
  const isAdmin = me?.data?.admin === true;

  const renderHomeIcon = useCallback(
    ({color}: {color: string}): React.ReactElement => <TabBarIcon color={color} name="home" />,
    []
  );

  const renderMoviesIcon = useCallback(
    ({color}: {color: string}): React.ReactElement => <TabBarIcon color={color} name="film" />,
    []
  );

  const renderSearchIcon = useCallback(
    ({color}: {color: string}): React.ReactElement => <TabBarIcon color={color} name="search" />,
    []
  );

  const renderProfileIcon = useCallback(
    ({color}: {color: string}): React.ReactElement => <TabBarIcon color={color} name="user" />,
    []
  );

  const renderAdminIcon = useCallback(
    ({color}: {color: string}): React.ReactElement => <TabBarIcon color={color} name="cog" />,
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
        name="movies"
        options={{
          headerShown: false,
          tabBarIcon: renderMoviesIcon,
          title: "Movies",
        }}
      />
      <Tabs.Screen
        name="search"
        options={{
          headerShown: false,
          tabBarIcon: renderSearchIcon,
          title: "Search",
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
      <Tabs.Screen
        name="admin"
        options={{
          headerShown: false,
          href: isAdmin ? "/admin" : null,
          tabBarIcon: renderAdminIcon,
          title: "Admin",
        }}
      />
    </Tabs>
  );
};

// Expo Router requires default export for route files
export default TabLayout;
