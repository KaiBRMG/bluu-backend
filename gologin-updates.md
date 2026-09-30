The GoLogin system will now be upgraded to allow creating/deleting/updating profiles with some minor additional features.

src\app\gologin > Management currently facilitates member and profile access. Change 'Management' -> 'Members'. This dialog will become to manage members only. Ensure users can add, or remove members from here. Ensure that removed members cannot access profiles from GoLogin directly, and ensure members can't access the internal GoLogin page (window). Profile access will be moved (see below).

Add an options button to each profile row in the main table. Display the following item option for everyone: 'Pin' (or Unpin). When clicked, this must add the profile to an internal (non-GoLogin) folder called 'Pinned'. If this folder is not empty, it should be the default folder on startup.


Add the following to the options menu:
- Edit Profile -- open a side panel showing all information of a profile. If a field is edited, show a save button.
- Delete Profile -- this action deletes a profile. First show a confirmation dialog.
- Add Profile to Folder -- open a small card to allow the user to add to one or more GoLogin folders. Ensure the system generated user folders are not displayed here.
- Share Profile -- this can open the 'Share' dialog (see below).


Add a new button at the top: 'New Profile' -- must open a large centered dialog to create a new profile.
Creating a profile:
- GoLogin provides many configurable parameters but not all is needed.
- When creating a new profile, the following must be configurable: profile name, add to one or more folders (optional), OS (Win 10, Win 11, Mac M1, Mac Intel), Proxy or without proxy, IP Address+Port+Username+Password (if proxy). Also include a ping proxy button and show the results.
- All other information can stay as the default. 
- It's important that profiles are correctly configured as an incorrectly configured one could cause a ban on whatever social media account is used within the profile. So for this reason you must make sure the implementation is sound and correct. Consult documentation extensively where you are unsure, and prompt me if there is any uncertainty.

Add a new button at the top: 'Sharing' -- must open a large centered dialog that allows sharing or unsharing one or more profiles or one or more folders with one or more users. This replaces the old Profile Access interface. 

In the category (folders) section on the main page, add a small button somewhere "Edit Folders". This must open a large centered dialog that allows the user to create, edit, or delete folders, and assign one or more profiles to one or more folders.


* In src\app\(main)\admin-portal\sharing in the GoLogin section add gates for each of the features above. GoLogin sharing must have the following subitems: 'Add & Remove Members'; 'Create, Edit & Delete Profiles'; 'Create, Edit & Delete Folders'; 'Share Profiles & Folders'.




** Read GoLogin documentation: [https://gologin.com/docs/api-reference] -- actually read it, don't make assumptions. ** Check first whether all that is required is even possible using the API.
** Once you are finished with implementation, run /impeccable critique on all GoLogin interfaces.
** Prompt me on implementation decisions and design decisions.