@section('title', 'Schema Editor')
@extends('layouts.home')

@section('content')
    <schema-editor-container :initial-data='@json($initialData)'></schema-editor-container>
@endsection
