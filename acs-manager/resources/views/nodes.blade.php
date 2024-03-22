@section('title', 'Nodes')
@extends('layouts.home')

@section('content')
    <node-container :initial-data='@json($initialData)'></node-container>
@endsection