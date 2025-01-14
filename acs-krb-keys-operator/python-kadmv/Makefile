.PHONY: dist clean publish install

dist:
	python3 setup.py sdist

publish:
	twine upload dist/*

clean:
	rm -rf build dist

install:
	python3 setup.py install
