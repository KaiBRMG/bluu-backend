# Context

A new page has been created called 'Growth Tracking'. The intended use of this page is to see the growth (followers) of Facebook and Twitter pages.
Page location: `src\app\(main)\smm-portal\growth-tracking`

`Apify` is the chosen API provider using 2 Actors for Facebook and Twitter scraping respectively.

The idea is to run a GCP Function once a day at 00:00 UTC that scrapes only the follower counts of selected acccounts on Facebook and Twitter respectively. The data must be stored in a collection which is subsequently displayed on this page. Read the API documentation below. Ensure that only the follower counts are retrieved and no additional data that might incur additional costs -- *apify costs must be minimised as far as possible*. If additional data such as likes or other analytics can be retrieved at no extra cost, add it to the payload and display it on the page where relevant. API key: `APIFY_API_KEY`. Keep in mind: API requests might take 10 to 30 seconds to complete.

Use the `/impeccable` skill for designing the page. Think of a smart and innovative way of displaying the accounts and their growth over time -- across Facebook and Twitter. The page should cater for ~5 Facebook accounts and ~7 Twitter accounts -- but this will scale over time. Create a secondary dashboard on this page for managing the accounts -- the user should be able to add/remove accounts here that must be scraped. Ensure data validation is applied where relevant and handle errors gracefully. 

* IMPORTANT: ask questions for certainty -- do not assume load-bearing decisions.

* Note that the accounts used here should not be connected to the twitterx-accounts collection in any way. We will integrate this better at a later stage.



# Documentation

## Facebook Actor Documentation
Read https://apify.com/apify/facebook-pages-scraper.md for this Actor's README, input/output schema, pricing, and ready-to-use JS/Python/CLI/MCP examples. Use the exact input fields from that schema — don't invent parameters.


## Twitter Actor Documentation

Read https://apify.com/apidojo/twitter-user-scraper.md for this Actor's documentation.

# Historical CSV files
Find `BLUU _ Central Growth Tracking _ 2026 - JULY` & `BLUU _ Central Growth Tracking _ 2026 - AUGUST` for July and August respectively. 

- Note that these were working documents so there is a lot of extra fluff -- manually inspect the documents to understand what must be extracted and how. 

- Only extract data for these accounts:
# Facebook
Adam (Followers)
Cole (Followers)
Connor (Followers)
Leo (Followers)
Noah Ryder (Followers)
# Twitter
TwinkUniversity
TwinkLoad
TwinkPublic
TwinkKinkz
TwinkToons
TwinkDong
TwinkCheeks

- The above accounts can be used to seed with. Here are their URLS:
Adam - https://www.facebook.com/adamtwinkx
Cole - https://www.facebook.com/xColeBentley
Connor - https://www.facebook.com/connorsfacebook/
Leo - https://www.facebook.com/LeoTwxnk/
Noah Ryder - https://www.facebook.com/NoahRyderXX
TwinkUniversity - https://x.com/TwinkUniversity
TwinkLoad - http://twitter.com/TwinkLoad
TwinkPublic - http://twitter.com/TwinkPublic
TwinkKinkz - http://x.com/twinkkinkz
TwinkToons - http://www.twitter.com/TwinkToons
TwinkDong - http://twitter.com/TwinkDong
TwinkCheeks - http://twitter.com/TwinkCheeks