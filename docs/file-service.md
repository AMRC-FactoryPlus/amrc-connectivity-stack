# AI-24-477-ACS-File-Service Design Spec DRAFT

## Objectives
This service aims to store non-primitive data types, such as PDFs, CSVs, CAD models, etc, and associate them with objects in F+. The service will perform file format validation while facilitating the download, upload and listing of files available in storage.

## Architecture
The service will utilise Express.js through NodeJS, React and Kubernetes. 
- Express will handle the API and communicating with F+
  - Authorisation will be handled by ACS Auth Service
  - File Association will be handled by ACS ConfigDB Service 
- Kubernetes volumes will handle file storage
- Frontend will be built with React

![File Service Architecture](./assets/file-service/File_Service_Architecture.png?raw=true)


## Users and Roles

- ACS Administrator
- Uploader
- Downloader
- Reader

## User Stories

1. As an ACS Admin I want to:
   1. Create application for File Service within ACS ConfigDB Service
   2. Create Access Control Entries (ACEs) within the application for uploading, downloading and viewing files on the target object (e.g device)
   3. Download files 
   4. Upload files
   5. View files
2. As an Uploader I should be authorised to:
   1. View list of target objects available on the frontend
   2. Upload files to target objects
   3. Download files from target objects
3. As a Downloader I should be authorised to:
   1. View list of target objects available on the frontend 
   2. Download files from target objects
4. As a Reader I should be authorised to:
   1. View list of target objects available on the frontend

## Solution Requirements and Data Sources

### Data Sources
- ACS Auth Service
- ACS ConfigDB Service
- Kubernetes internal Volume

### Solution Requirements
- Storage Location for Files
- A way to authorise actions (viewing, uploading, downloading) for each target 
- A way to associate files with target objects

## Proposed Solution - Feature Specification
POST /v1/file/:type
GET /v1/file/:uuid

- GET /targets 
  - Params: (principal_uuid, view_permission_uuid)
  - The purpose of this endpoint is to provide the user with the list of available target objects for the user to select from.  
- POST /upload
  - Params: (file, principal_uuid, instance_uuid, upload_permission_uuid)
  - The purpose of this endpoint is to allow the user to upload a file to the Kubernetes volume and store the file metadata (including target uuid) as an object in ACS ConfigDB.
- GET /download
  - Params: (file_uuid, principal_uuid, download_permission_uuid, instance_uuid)
  - Return: file 
  - The purpose of this endpoint is to allow the user download a selected file from the Kubernetes volume, by providing its uuid stored in the ACS ConfigDB service.
 
![Sequence Diagram](./assets/file-service/SequenceDiagramFileService.drawio.png?raw=true)




## Todo: 

- Create Application uuid in config store for File service
- Create class for file type then within in create types for PDF, other file types
- Create permission uuid for uploading, downloading

- Understand how Ben's library for interacting with ACS Auth (use the one with Kerberos) and ACS Config works
- Use Auth, then use Auth to check for permissions (upload, download)
- Upload file providing the type of file as uuid (PDF, ...)
- Upload file to local directory, file name should not have extensions or filename, the file should be named as its uuid
- Store the file object in config db as follows:
    - file uuid
    - file type uuid
    - date uploaded
    - user who uploaded
    - file size ?
    - application uuid


