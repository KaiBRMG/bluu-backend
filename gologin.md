The GoLogin system will now be upgraded to allow creating/deleting/updating profiles with some minor additional features.

src\app\gologin > Management currently facilitates member and profile access. Change 'Management' -> 'Members & Access'.

Add an options button to each profile row in the main table. Display the following item option for everyone: 'Pin' (or Unpin). When clicked, this must add the profile to an internal (non-GoLogin) folder called 'Pinned'. If this folder is not empty, it should be the default folder on open.

Create a new subitem in src\app\(main)\admin-portal\sharing in the GoLogin section called 'Profile Management' which must gate the following:
- Profile item option: Edit Profile -- open a side panel showing all information of a profile. If a field is edited, show a save button.
- Profile item option: Delete Profile -- this action deletes a profile. First show a confirmation dialog.
- Profile item option: Add Profile to Folder -- open a small card to allow the user to add to one or more GoLogin folders. Ensure the system generated user folders are not displayed here.
- Profile item option: Share Profile -- this can open the 'Members & Access' dialog and route to Profile access.
- New button at the top: 'New Profile' -- must open a large centered dialog to create a new profile.

** Read GoLogin documentation: [https://gologin.com/docs/api-reference] -- actually read it, don't make assumptions.