SMM Portal

Teamspace ID: 'smm-portal'
Pages: 
- 'smm-admin'
- 'smm-dashboard'
- 'smm-twitterx'

# Context

Just as how the CA user group has their own team space (CA Portal), the SMM group will now have their own teamspace. The SMM user group deals with Social Media Management and as such the teamspace will have different pages for each social media but we will start with Twitter/X only. The dashboard page is custom page for each user that will allow them to manage their work, and the Admin page will be used by the manager to manage all SMM users.

# Firestore collections
To create:

1. `twitterx-accounts`
- creatorName 
- accLink
- type 
- assigned
- driveLink
- lastUpdatedTime
- lastUpdatedBy
* note that 'type' must be able to store many fields at once (multi-select).
* 'assigned' must map to the users collection and may store more than 1 value.
* 'lastUpdatedBy' must map the users collection.
* 'lastUpdatedTime' must update automatically when the entry is updated.

2. `twitterx-content-schedule`
- caption
- account
- postDate
- postLink
- postedBy
- createdTime
* 'account' must map to `twitterx-accounts`.
* 'postedBy' must map to the users collection.
* 'createdTime' must update automatically when the entry is created.


# Pages

## smm-dashboard
- This page must be a personal workspace for each user.
- Split the page into 2 columns where the left column takes ~75% of the width and the right column takes the remaining 25%.
Left Column:
- 


## smm-admin



## smm-twitterx
- You will see in definitions.ts, the icon parameter for this page is empty. Use a custom icon: `src\public\Icons\icons8-x.svg`. Ensure the sizing is consistent with all other icons in the sidebar.


# Other Instructions
- Firestore reads/writes must always be minimised.
- Ensure all interfaces are stylish; use the frontend-design skill for UI/UX.
- Use the simplify skill after you have finished implementing your solution.