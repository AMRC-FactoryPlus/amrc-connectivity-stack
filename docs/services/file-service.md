# File Service

## Objectives
This service enables the storage of non-primitive data types, such as PDFs, CSVs, CAD models, and other files. It allows these files to be associated with objects in the **ACS ConfigDB**. The service facilitates file upload, download, and listing of files.

## Architecture
This service is a web-based application built using the **WebAPI** module from the **js-service-api** library, which leverages Express.js. It integrates with the ACS Auth Service for authentication and authorisation, verifying whether a request is permitte to upload or download files by checking for the appropriate **ACL** (Access Control List) entry.

Uploaded files are stored in a **Kubernetes volume**, while their metadata is recorded in the **ACS ConfigDB**.

## Implementation
### ACS ConfigDB
#### Application
A `Files Configuration` application with UUID `731cb924-71bb-49fa-8cb8-1584bd1ebad3` is created in ACS ConfigDB. This application stores the configurations of all uploaded files, mapped to their respective `File` objects using UUIDs.

#### File Class Definition
A Rank1 `File` Class (`b8fae5ab-678e-4d35-802f-2dd8ee3b5b02`) is created. This class is used to create `File` objects during the upload process. These objects store metadata about the uploaded files in the following format
```javascript
file_uuid
date_uploaded
user_who_uploaded
file_size
application_uuid
original_file_name
```

These `File` objects are then stored under the `Files Configuration` application, indexed by the value of their `file_uuid`.

#### Auth Permissions
A service permission set, `Files permission`, is created as a subclass of `Permission` class. This `Files permission` set contains two specific permissions: `Upload` and `Download`.

- **Files permission** `09cce2eb-dc82-4a5a-b2ec-bca12f456ab8`
  - **Upload** `81ed0b6c-7305-4f51-85c5-5c66bdac7920`
  - **Download** `3b436260-2100-454b-aea5-8f933a1ed7e5`


### ACS Auth
The permissions for principals to `Upload` or `Download` files are granted through **ACS Auth** by creating appropriate **ACLs** in
```javascript
Principal UUID - Permission UUID - Target UUUD
```

### ACS Files
The following endpoints are exposed for the **ACS-Files** service:

#### `GET /v1/file/:uuid`
- Checks whether the requesting principal has **Download** permission for the file with the specified `uuid` by calling ACS Auth Service.
- If authorised, the file is retrieved from storage by the `uuid` and returned to the requester as a **binary data stream** for download.

#### `PUT /v1/file/:uuid`
- Checks whether the requesting principal has **Upload** permission for the `Files Configuration` Application.
- Checks if a **File Object** exists with the given uuid. 
- If valid:
  - The file contents is written to a temporary file in the Kubernetes volume.
  - The temporary file is renamed using the file UUID from the request path, making it available for download. 
  - The file's metadata is stored in ACS ConfigDB under the `Files Configuration` application, mapping it to the file's UUID. This ensures that files in storage and their metadata in ConfigDB remain **linked**.

#### `GET /v1/file`
- **Admin-only endpoint**
- Returns a **list of all files** available in storage.

#### `POST /v1/file` `❌ REMOVED`
- Checks whether the requesting principal has **Upload** permission for the `Files Configuration` Application.
- If authorised:
  - A new **File** object is created in ACS ConfigDB, generating a UUID for the file.
  - The file is uploaded to storage using the newly generated UUID as its filename.
  - The file's metadata is stored in ACS ConfigDB under the `Files Configuration` application, mapping it to the file's UUID. This ensures that files in storage and their metadata in ConfigDB remain **linked**.

