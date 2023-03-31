@section('title', 'Device Editor')
@extends('layouts.home')

@section('content')
    <device-editor-container :initial-data='@json($initialData)'></device-editor-container>
@endsection