# Google OAuth Configuration
# TODO: Get these from: https://console.cloud.google.com/apis/credentials
# 1. Create OAuth 2.0 Client ID (Web application)
# 2. Add authorized redirect URI: http://localhost:3000/auth/callback
# 3. Copy Client ID and Client Secret below

# NEXT_PUBLIC_GOOGLE_CLIENT_ID=211818603920-pnm2245hck2oa2k62ufabegfs370dut3.apps.googleusercontent.com
# GOOGLE_CLIENT_SECRET=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

NEXT_PUBLIC_GOOGLE_CLIENT_ID=211818603920-a7cvmjkto4thki9n5tlfoq5kpn9lvuhd.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=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

# OAuth Redirect URI
NEXT_PUBLIC_REDIRECT_URI=http://localhost:3000/auth/callback

# Firebase Admin SDK Service Account
# TODO: Get this from Firebase Console > Project Settings > Service Accounts
# 1. Click "Generate new private key"
# 2. Download the JSON file
# 3. Paste the entire JSON content below as a single line (no line breaks)

FIREBASE_SERVICE_ACCOUNT={"type": "service_account","project_id": "bluu-backend","private_key_id": "ce832369efd6e07f5c27867ab68340d2d3b93805","private_key": "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQCWSddCz2R+SZT3\n/V6XLqqC97fy6fRvgFAFJRVMZz36NZVCcTnhCraQ5e18V/8bwpzK7EEVzoimhvjf\nht9pggPFaJJwYkuuh7gObBSce/b4P7JTppYcqT5J/VhR3bSdTQK0lWI2+9oRkPHA\nqLf36qlpfsNqZIDPC2rCez0GsIg6+XpS1q22ZgT2M55/Spwxvq7pS7fg/aC06huj\nWFl4zT8e2qMA859XuYfhwKdcQBNnLtxEXoh0SNRkaTOeeDmCzJqaCQVs0Ggdt+G+\nc5YZjeEygpBuXfQYtKg0PkfeWyxzrTUr5xrSM6dlU9Ns5n1HLO7PjI6xhiMP57ij\n2lANlXvdAgMBAAECggEAA+rJybaBHoo0GqCdJ2CdK3Zhx4WR4ZlyZyftHbAv3TEq\nAkYpkDQzck8Ojmf2wMD6TY8J2pPRsPwh9CWI9jA1gUmKo5OUTb4WLd4Nos8tA+cZ\nHUq2wpQmCPn++XycrrWT+qP4IDRr8yWYKiww8K0fnEh5txtb1h8B5IQfdj4CAajL\nuuDNbEyeDoHK+N6/w5mjH7sMnjc8JBnTmBigJFgcvl3ch9wCS4RmI0MWrcTFoKQn\n1t3WgPh0umsbCUKLCyUe8SvRFUodcJdFuTXah8muvQUBnW5K6aUuay56k7FibT+e\nek1gqIivsQ/hhauhvKIJ/EbN1xhvcMWag8buUWK7wQKBgQDUielsDYfnN2nPyROW\nf9D26pQZ/vRcBmAzNmpwzCf7C+EiifFw3rIOUY+jhiZZ6a8CwvMUN1L9V84eeBet\nVDh1BUVqN/lkISF6mVB4lg5PA27/JkCLFEBxxVfK2ei4V9symtsyOQJMJFmYrkg1\nscdI3I1G2m38QBgROMv/ihTN/QKBgQC1BTgLqrW/jzPkcXeYaegdc10edIeNxGY8\nKdr2/ck/AblZPcC9qwGU8KXSOfHzOj217vjMnTtS+/IDVfLMbBmXaYnLP4z/CP6q\nA44cMZA6OxqqhNmxdooiPxuT8ks4V1x0VBJiQTfqtymmcTaVrNwtIg/5MwwU8kY0\n78wiKCzbYQKBgDDSFQo6+XLFKcsO9y7k4U02iRqHk/3ngQWChGSwoKZsDiTu5sT0\ngpYDaik30Wtp4EeUHF4Sbz++gZxCHb400FshANbrUKANdDFDMlbgsRy5Py/gy4am\n+j6oBAiWkXx2weUX6S3aJory9pm5vuCGm65C6zjRR95foqeiEkn6n9jJAoGANBOq\nSgD0hIWIIkJaa6icNEzKD0bq8Gf+GXTZH5FnYg726auQVYBq1hRdQBuXdafdtQdo\n4ESjmn4M49TIIvM+cYbVM3m28HAAA50+NvIzUe1LAJ9zmVBG8Q9Cuc9MwIqxeG3v\nVAD7OzUycEXFtE2kkf9opQKAiU4h0HzkNzdjoEECgYEAqafkp0FV5+yQWH7KPkth\n7Drkg34JI8rJTVfWa63fqzG1ixY5RqraFTqFyLBMBCXc4FZLrPPX74zZyR+yQ5mZ\nx/SXc/tQHvzTeSa/tBd3qWB01yf/7AGSRy5DiJJHWKQgnhohkg4Y7mUoWBrVe44r\nhheIOKmV04sr6RhOoFO5Rik=\n-----END PRIVATE KEY-----\n","client_email": "firebase-adminsdk-fbsvc@bluu-backend.iam.gserviceaccount.com","client_id": "107517161642100657380","auth_uri": "https://accounts.google.com/o/oauth2/auth","token_uri": "https://oauth2.googleapis.com/token","auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs","client_x509_cert_url": "https://www.googleapis.com/robot/v1/metadata/x509/firebase-adminsdk-fbsvc%40bluu-backend.iam.gserviceaccount.com","universe_domain": "googleapis.com"}
