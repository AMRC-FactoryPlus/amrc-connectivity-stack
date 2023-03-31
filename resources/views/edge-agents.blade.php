@section('title', 'Edge Agents')
@extends('layouts.home')

@section('content')
    <edge-agent-container :initial-data='@json($initialData)'></edge-agent-container>
@endsection