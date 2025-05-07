all: v3-deploy.svg dyn-deploy.svg

.SUFFIXES: .puml .svg

.puml.svg:
	plantumlc $< -tsvg
