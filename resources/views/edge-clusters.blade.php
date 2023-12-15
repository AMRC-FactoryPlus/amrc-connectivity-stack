@section('title', 'Edge Clusters')
@extends('layouts.home')

@section('content')
    <edge-cluster-container :initial-data='@json($initialData)'></edge-cluster-container>
@endsection
